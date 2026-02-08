import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens, findCutPoint, generateSummary, type SessionManager } from "@mariozechner/pi-coding-agent";
import type { AgentCompactionStartupPruningConfig } from "../config/types.agent-defaults.js";
import { resolveContextWindowInfo } from "./context-window-guard.js";
import { DEFAULT_CONTEXT_TOKENS } from "./defaults.js";

/**
 * Prunes a session's message history on startup if it exceeds the configured target tokens.
 * This prevents loading bloated sessions that would immediately hit context limits.
 *
 * Uses pi-coding-agent's findCutPoint() to determine where to prune, then creates
 * a new branched session file containing only the kept entries.
 *
 * @param sessionManager The Pi SessionManager instance with loaded transcript
 * @param config Startup pruning configuration
 * @param provider Model provider (e.g., "anthropic")
 * @param modelId Model ID (e.g., "claude-sonnet-4-0")
 * @returns True if pruning was applied, false otherwise
 */
export async function applyStartupPruning(params: {
  sessionManager: SessionManager;
  config: AgentCompactionStartupPruningConfig;
  provider: string;
  modelId: string;
}): Promise<boolean> {
  const { sessionManager, config, provider, modelId } = params;

  // Check if startup pruning is enabled
  if (!config.enabled) {
    return false;
  }

  // Get all session entries
  const allEntries = sessionManager.getEntries();

  if (allEntries.length === 0) {
    return false;
  }

  // Get context window for this model
  const contextWindowInfo = resolveContextWindowInfo({
    cfg: undefined,
    provider,
    modelId,
    modelContextWindow: undefined,
    defaultTokens: DEFAULT_CONTEXT_TOKENS,
  });
  const contextWindow = contextWindowInfo.tokens;

  // Determine target tokens (default: 80% of context window)
  const targetTokens = config.targetTokens ?? Math.floor(contextWindow * 0.8);

  // Get current session context (resolved messages sent to LLM)
  const sessionContext = sessionManager.buildSessionContext();
  const messages = sessionContext.messages;

  // Estimate current token count using sum of individual message estimates
  const currentTokens = estimateMessagesTokens(messages);

  // Check if pruning is needed
  if (currentTokens <= targetTokens) {
    return false;
  }

  // Calculate tokens to keep (leave some buffer)
  const keepRecentTokens = Math.floor(targetTokens * 0.9);

  // Find where to cut based on token budget
  const cutResult = findCutPoint(allEntries, 0, allEntries.length, keepRecentTokens);

  if (cutResult.firstKeptEntryIndex === 0) {
    // No pruning needed - all entries fit within target
    return false;
  }

  // Get the entry ID to branch from
  const firstKeptEntry = allEntries[cutResult.firstKeptEntryIndex];
  if (!firstKeptEntry) {
    console.warn("[startup-pruning] Could not find first kept entry");
    return false;
  }

  const strategy = config.strategy ?? "keep-recent";
  const droppedCount = cutResult.firstKeptEntryIndex;
  const keptCount = allEntries.length - droppedCount;

  // Sanity check: warn if keeping fewer than minRecentMessages
  const minRecentMessages = config.minRecentMessages ?? 10;
  const keptMessageCount = allEntries
    .slice(cutResult.firstKeptEntryIndex)
    .filter((e) => e.type === "message").length;

  if (keptMessageCount < minRecentMessages) {
    console.warn(
      `[startup-pruning] Keeping only ${keptMessageCount} messages (min: ${minRecentMessages}), but proceeding to stay under token limit`,
    );
  }

  // Create a new branched session with only kept entries
  // First, we need to branch to just before the first kept entry
  const parentOfKept = firstKeptEntry.parentId;

  if (!parentOfKept) {
    console.warn("[startup-pruning] First kept entry has no parent - cannot prune");
    return false;
  }

  try {
    let newSessionPath: string | undefined;

    if (strategy === "keep-summarized") {
      // Get the messages that would be dropped for summarization
      const droppedEntries = allEntries.slice(0, cutResult.firstKeptEntryIndex);
      const droppedMessages = droppedEntries
        .filter((entry): entry is { type: "message", data: AgentMessage } => entry.type === "message")
        .map((entry) => entry.data);

      if (droppedMessages.length > 0) {
        console.log(`[startup-pruning] Creating AI-powered summary for ${droppedMessages.length} dropped messages`);
        
        try {
          // Generate AI-powered summary of dropped messages
          const modelString = `${provider}/${modelId}`;
          const reserveTokens = 2000; // Reserve tokens for the summary itself
          const customInstructions = "Summarize this conversation history concisely, preserving key context, decisions, and important details. Focus on maintaining continuity for the ongoing conversation.";
          
          const aiSummary = await generateSummary(
            droppedMessages,
            modelString,
            reserveTokens,
            undefined, // apiKey - will use default from environment
            undefined, // signal - no cancellation needed
            customInstructions,
            undefined  // previousSummary - no prior summary to build on
          );

          const summaryMessage = `## Session History Summary

${aiSummary}

---

*This summary was generated from ${droppedMessages.length} earlier messages that were removed during startup pruning to manage context size.*`;

          // Add the AI-generated summary as a system message before the kept content
          sessionManager.addSystemMessage(summaryMessage);

          console.log(`[startup-pruning] Added AI-generated summary of dropped context`);
        } catch (error) {
          console.warn(`[startup-pruning] AI summarization failed, falling back to basic summary:`, error);
          
          // Fallback to basic summary if AI summarization fails
          const userMessages = droppedMessages.filter(msg => msg.role === "user").length;
          const assistantMessages = droppedMessages.filter(msg => msg.role === "assistant").length;
          const systemMessages = droppedMessages.filter(msg => msg.role === "system").length;
          
          const basicSummary = `## Session History Summary

This session had ${droppedMessages.length} earlier messages that were removed during startup pruning to manage context size:
- ${userMessages} user messages
- ${assistantMessages} assistant messages  
- ${systemMessages} system messages

The conversation history before this point has been condensed to preserve context window space.

---

*Note: AI-powered summarization failed, using basic summary as fallback.*`;

          sessionManager.addSystemMessage(basicSummary);
          console.log(`[startup-pruning] Added fallback summary of dropped context`);
        }
      } else {
        console.log(`[startup-pruning] No messages to summarize, proceeding with pruning`);
      }
    }

    // Branch to the parent of the first kept entry
    sessionManager.branch(parentOfKept);

    // Create a branched session from the first kept entry
    // This will create a new file with only the path from root to first kept entry
    const leafId = sessionManager.getLeafId();
    if (leafId) {
      newSessionPath = sessionManager.createBranchedSession(leafId);
    }

    if (!newSessionPath) {
      console.warn("[startup-pruning] Failed to create branched session");
      return false;
    }

    console.log(
      `[startup-pruning] Pruned ${droppedCount} entries, kept ${keptCount} (${currentTokens} → ~${keepRecentTokens} tokens)`,
    );
    console.log(`[startup-pruning] New session file: ${newSessionPath}`);

    // Switch to the new session file
    sessionManager.setSessionFile(newSessionPath);

    return true;
  } catch (error) {
    console.error("[startup-pruning] Error during pruning:", error);
    return false;
  }
}

/**
 * Estimate total tokens for an array of messages
 */
function estimateMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}
