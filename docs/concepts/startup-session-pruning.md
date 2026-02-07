---
summary: "Startup session pruning: prevent bloated sessions from hitting context limits on load"
read_when:
  - Sessions are hitting context limits immediately after startup
  - You want to configure automatic session pruning on load
  - You are tuning agents.defaults.compaction.startupPruning
---

# Startup Session Pruning

Startup session pruning automatically reduces session size **on load** to prevent bloated sessions from immediately hitting context limits. Unlike runtime [session pruning](/concepts/session-pruning), this creates a **new branched session file** with only the kept entries.

## When it runs

- **On session startup** after `SessionManager.open()` loads the session file
- Only when `agents.defaults.compaction.startupPruning.enabled` is `true`
- Before any LLM calls are made
- Creates a new branched session file (e.g., `session.branch-20240207.jsonl`)

## How it differs from runtime pruning

| Feature | Runtime Pruning | Startup Pruning |
|---------|----------------|------------------|
| **When** | Before each LLM call | Once on session load |
| **Scope** | Tool results only | All message types |
| **Persistence** | Transient (in-memory) | Creates new session file |
| **Trigger** | TTL expiration | Token count exceeds target |

## Configuration

Add to `~/.openclaw/openclaw.json` under `agents.defaults.compaction`:

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "mode": "safeguard",
        "startupPruning": {
          "enabled": true,
          "targetTokens": 160000,
          "strategy": "keep-recent",
          "minRecentMessages": 10
        }
      }
    }
  }
}
```

## Config options

### enabled
- **Type**: `boolean`
- **Default**: `false`
- Whether to enable startup pruning

### targetTokens
- **Type**: `number`  
- **Default**: 80% of model context window
- Maximum tokens to load into session context
- Uses same estimation as runtime pruning (chars ≈ tokens × 4)

### strategy
- **Type**: `"keep-recent" | "keep-summarized"`
- **Default**: `"keep-recent"`
- **keep-recent**: Keeps only the most recent messages within the token budget
- **keep-summarized**: Creates a summary of dropped messages and includes it in the pruned session

### minRecentMessages
- **Type**: `number`
- **Default**: `10`
- Minimum number of recent messages to preserve
- Prevents over-aggressive pruning of important context

## How it works

1. **Token Estimation**: Calculate total tokens in loaded session
2. **Check Threshold**: If under `targetTokens`, no pruning needed
3. **Find Cut Point**: Use pi-coding-agent's `findCutPoint()` to determine where to prune
4. **Respect Minimums**: Ensure at least `minRecentMessages` are kept
5. **Create Branch**: Generate new session file with only kept entries
6. **Switch Session**: Update SessionManager to use the pruned file

## Identity-aware pruning

For agents with `identityPersistence` enabled, startup pruning uses enhanced logic:

- **Preserves identity context**: Core identity messages are protected from pruning
- **Smart boundaries**: Respects conversation boundaries and important context
- **Optimized targets**: Uses identity-specific token targets when available

## File management

### Naming convention
- Original: `session-main-abc123.jsonl`
- Pruned: `session-main-abc123.branch-20240207-143022.jsonl`

### Cleanup
- Original session files are preserved as backups
- Pruned files become the active session
- Future cleanup tools may archive old branches

## Troubleshooting

### Startup pruning not running
- Check `enabled: true` in config
- Verify session token count exceeds `targetTokens`
- Look for `[startup-pruning]` logs in OpenClaw output

### Over-aggressive pruning
- Increase `targetTokens`
- Increase `minRecentMessages`
- Check if important messages are being lost

### Performance impact
- Pruning adds ~1-2 seconds to session startup
- Only runs once per session load
- Beneficial for very large sessions (>100k tokens)

## Integration with other features

### Compaction
- Startup pruning complements but doesn't replace compaction
- Compaction summarizes and persists, startup pruning creates lighter branches
- Both can be enabled simultaneously

### Runtime pruning
- Startup pruning creates smaller initial context
- Runtime pruning then manages tool result growth during conversation
- Recommended to enable both for optimal memory management

### Identity persistence
- Enhanced pruning logic when identityPersistence is enabled
- Automatic detection and preservation of identity context
- Falls back to standard pruning for agents without identity features

## Examples

### Basic startup pruning
```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "startupPruning": {
          "enabled": true,
          "targetTokens": 120000
        }
      }
    }
  }
}
```

### Conservative pruning
```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "startupPruning": {
          "enabled": true,
          "targetTokens": 180000,
          "minRecentMessages": 20
        }
      }
    }
  }
}
```

### Summarized pruning
```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "startupPruning": {
          "enabled": true,
          "targetTokens": 120000,
          "strategy": "keep-summarized",
          "minRecentMessages": 15
        }
      }
    }
  }
}
```

### Combined with runtime pruning
```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "mode": "safeguard",
        "startupPruning": {
          "enabled": true,
          "targetTokens": 160000
        }
      },
      "contextPruning": {
        "mode": "cache-ttl",
        "ttl": "5m"
      }
    }
  }
}
```

## Monitoring

Look for these log messages to monitor startup pruning:

```
[startup-pruning] Session pruned on load: 180k → 120k tokens
[startup-pruning] Identity-aware pruning applied
[startup-pruning] Created branch: session-main-abc123.branch-20240207-143022.jsonl
```

See also: [Session Pruning](/concepts/session-pruning), [Compaction](/concepts/compaction), [Identity Persistence](/identity-persistence)