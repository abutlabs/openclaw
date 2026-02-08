# Startup Session Pruning Implementation

## Status: Ready for Integration

This PR adds configurable startup session pruning to prevent bloated sessions from immediately hitting context limits on load.

## What's Implemented

1. ✅ **Config Types** (`src/config/types.agent-defaults.ts`)
   - Added `AgentCompactionStartupPruningConfig` type
   - Added `startupPruning` field to `AgentCompactionConfig`

2. ✅ **Schema Validation** (`src/config/zod-schema.agent-defaults.ts`)
   - Added Zod schema for `startupPruning` config option

3. ✅ **Pruning Logic** (`src/agents/startup-pruning.ts`)
   - Uses pi-coding-agent's `findCutPoint()` to determine where to prune
   - Creates branched session with only kept entries
   - Supports two strategies: `keep-recent` and `keep-summarized` (both implemented)

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

### Config Options

- **`enabled`** (boolean, default: false) - Enable startup pruning
- **`targetTokens`** (number, default: 80% of context window) - Max tokens to load
- **`strategy`** ("keep-recent" | "keep-summarized", default: "keep-recent") - Pruning strategy
- **`minRecentMessages`** (number, default: 10) - Minimum messages to preserve

## Integration Steps

To complete the implementation, add startup pruning to session initialization:

### File to modify: `src/agents/pi-embedded-runner/run/attempt.ts`

After `SessionManager.open()` is called (around line 111 in transcript.ts), apply startup pruning:

```typescript
import { applyStartupPruning } from "../../startup-pruning.js";

// After: sessionManager = SessionManager.open(sessionFile);

// Apply startup pruning if enabled
const pruningConfig = cfg?.agents?.defaults?.compaction?.startupPruning;
if (pruningConfig?.enabled) {
  try {
    const wasPruned = await applyStartupPruning({
      sessionManager,
      config: pruningConfig,
      provider,
      modelId,
    });

    if (wasPruned) {
      console.log("[startup-pruning] Session was pruned on load");
    }
  } catch (error) {
    console.error("[startup-pruning] Error during startup pruning:", error);
    // Continue anyway - don't block session from loading
  }
}
```

## How It Works

1. **On Session Load**: After SessionManager loads the .jsonl file
2. **Check Token Count**: Estimate tokens in current session context
3. **Find Cut Point**: Use pi-coding-agent's `findCutPoint()` to determine where to prune
4. **Create Branched Session**: Use `createBranchedSession()` to create new file with only kept entries
5. **Switch Session File**: Update SessionManager to use the new pruned file

## Benefits

- **Prevents Context Overflow**: Sessions won't immediately hit 200k+ token limits
- **Configurable**: Toggle on/off, adjust target tokens, set minimum messages
- **Non-Destructive**: Creates new branched session file, original stays as backup
- **Uses Official APIs**: Leverages pi-coding-agent's built-in compaction utilities

## Testing

1. Create a bloated session (170k+ tokens)
2. Enable startup pruning in config
3. Restart OpenClaw
4. Verify:
   - Session loads successfully
   - Token count is reduced to target
   - Recent messages are preserved
   - New session file created

## Future Enhancements

- [ ] Add config option for archiving pruned sessions
- [ ] Add periodic pruning (not just on startup)
- [ ] Add metrics/logging for pruning activity

## PR Submission

This implementation is ready to be submitted as a PR to the main OpenClaw project:

1. All changes are backwards compatible (disabled by default)
2. Reuses existing pi-coding-agent APIs
3. Follows OpenClaw's config patterns
4. Includes comprehensive configuration options
5. Non-invasive - doesn't modify core session logic

## Files Changed

- `src/config/types.agent-defaults.ts` (config types)
- `src/config/zod-schema.agent-defaults.ts` (schema validation)
- `src/agents/startup-pruning.ts` (new file - pruning logic)
- Integration needed in: `src/agents/pi-embedded-runner/run/attempt.ts` or `session-manager-init.ts`

## Documentation

Docs should be added to `docs/concepts/session-pruning.md` explaining:
- When startup pruning triggers
- How it differs from runtime contextPruning
- Configuration options
- Troubleshooting tips
