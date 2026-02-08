/**
 * Mode for processing reasoning tags in text.
 * - "strict": Remove incomplete thinking blocks (default behavior)
 * - "preserve": Keep incomplete thinking blocks in output
 */
export type ReasoningTagMode = "strict" | "preserve";

/**
 * Trimming behavior for the cleaned text output.
 * - "none": No trimming applied
 * - "start": Remove leading whitespace only
 * - "both": Remove leading and trailing whitespace (default)
 */
export type ReasoningTagTrim = "none" | "start" | "both";

/** Regex to quickly detect if text contains any reasoning tags */
const QUICK_TAG_RE = /<\s*\/?\s*(?:think(?:ing)?|thought|antthinking|final)\b/i;

/** Regex to match and remove `<final>` tags */
const FINAL_TAG_RE = /<\s*\/?\s*final\b[^<>]*>/gi;

/** Regex to match thinking tags: <thinking>, <thought>, <antthinking> and their closing variants */
const THINKING_TAG_RE = /<\s*(\/?)\s*(?:think(?:ing)?|thought|antthinking)\b[^<>]*>/gi;

/**
 * Represents a region in text that contains code (fenced or inline),
 * where reasoning tags should be preserved rather than processed.
 */
interface CodeRegion {
  start: number;
  end: number;
}

/**
 * Finds all code regions (fenced and inline) in the text where reasoning tags
 * should be preserved rather than processed. This prevents accidentally removing
 * reasoning tags that are part of code examples or documentation.
 * 
 * @param text - The text to scan for code regions
 * @returns Array of code regions sorted by start position
 */
function findCodeRegions(text: string): CodeRegion[] {
  const regions: CodeRegion[] = [];

  // Find fenced code blocks (``` or ~~~ delimited)
  const fencedRe = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2(?:\n|$)|$)/g;
  for (const match of text.matchAll(fencedRe)) {
    const start = (match.index ?? 0) + match[1].length;
    regions.push({ start, end: start + match[0].length - match[1].length });
  }

  // Find inline code (`delimited`) that's not inside fenced blocks
  const inlineRe = /`+[^`]+`+/g;
  for (const match of text.matchAll(inlineRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const insideFenced = regions.some((r) => start >= r.start && end <= r.end);
    if (!insideFenced) {
      regions.push({ start, end });
    }
  }

  regions.sort((a, b) => a.start - b.start);
  return regions;
}

/**
 * Checks if a text position is inside any of the provided code regions.
 * Used to determine whether reasoning tags should be preserved.
 * 
 * @param pos - Character position to check
 * @param regions - Array of code regions to check against
 * @returns True if position is inside a code region
 */
function isInsideCode(pos: number, regions: CodeRegion[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

/**
 * Applies the specified trimming mode to a string.
 * 
 * @param value - String to trim
 * @param mode - Trimming mode to apply
 * @returns Trimmed string according to the specified mode
 */
function applyTrim(value: string, mode: ReasoningTagTrim): string {
  if (mode === "none") {
    return value;
  }
  if (mode === "start") {
    return value.trimStart();
  }
  return value.trim();
}

/**
 * Removes reasoning tags from text while preserving code blocks and handling edge cases.
 * 
 * This function processes text to remove AI reasoning tags like `<thinking>`, `<thought>`, 
 * `<antthinking>`, and `<final>` while being smart about preserving them when they appear
 * in code blocks or examples. It handles both opening and closing tags, nested structures,
 * and incomplete thinking blocks based on the specified mode.
 * 
 * Key features:
 * - Preserves reasoning tags inside fenced code blocks and inline code
 * - Handles incomplete thinking blocks (missing closing tags) based on mode
 * - Removes `<final>` tags completely
 * - Configurable whitespace trimming
 * - Fast early return for texts without reasoning tags
 * 
 * @param text - The input text to process
 * @param options - Configuration options for processing
 * @param options.mode - How to handle incomplete thinking blocks ("strict" removes, "preserve" keeps)
 * @param options.trim - Whitespace trimming mode ("none", "start", or "both")
 * @returns Cleaned text with reasoning tags removed according to specified options
 * 
 * @example
 * ```typescript
 * // Basic usage - removes thinking tags but preserves content outside them
 * const cleaned = stripReasoningTagsFromText("Hello <thinking>internal thought</thinking> world!");
 * // Returns: "Hello  world!"
 * 
 * // Preserve incomplete thinking blocks
 * const preserved = stripReasoningTagsFromText(
 *   "Text <thinking>incomplete thought", 
 *   { mode: "preserve" }
 * );
 * // Returns: "Text <thinking>incomplete thought"
 * 
 * // Custom trimming
 * const trimmed = stripReasoningTagsFromText(
 *   "  <final>done</final>  Content  ", 
 *   { trim: "start" }
 * );
 * // Returns: "Content  "
 * ```
 */
export function stripReasoningTagsFromText(
  text: string,
  options?: {
    mode?: ReasoningTagMode;
    trim?: ReasoningTagTrim;
  },
): string {
  if (!text) {
    return text;
  }
  if (!QUICK_TAG_RE.test(text)) {
    return text;
  }

  const mode = options?.mode ?? "strict";
  const trimMode = options?.trim ?? "both";

  let cleaned = text;
  if (FINAL_TAG_RE.test(cleaned)) {
    FINAL_TAG_RE.lastIndex = 0;
    const finalMatches: Array<{ start: number; length: number; inCode: boolean }> = [];
    const preCodeRegions = findCodeRegions(cleaned);
    for (const match of cleaned.matchAll(FINAL_TAG_RE)) {
      const start = match.index ?? 0;
      finalMatches.push({
        start,
        length: match[0].length,
        inCode: isInsideCode(start, preCodeRegions),
      });
    }

    for (let i = finalMatches.length - 1; i >= 0; i--) {
      const m = finalMatches[i];
      if (!m.inCode) {
        cleaned = cleaned.slice(0, m.start) + cleaned.slice(m.start + m.length);
      }
    }
  } else {
    FINAL_TAG_RE.lastIndex = 0;
  }

  const codeRegions = findCodeRegions(cleaned);

  THINKING_TAG_RE.lastIndex = 0;
  let result = "";
  let lastIndex = 0;
  let inThinking = false;

  for (const match of cleaned.matchAll(THINKING_TAG_RE)) {
    const idx = match.index ?? 0;
    const isClose = match[1] === "/";

    if (isInsideCode(idx, codeRegions)) {
      continue;
    }

    if (!inThinking) {
      result += cleaned.slice(lastIndex, idx);
      if (!isClose) {
        inThinking = true;
      }
    } else if (isClose) {
      inThinking = false;
    }

    lastIndex = idx + match[0].length;
  }

  if (!inThinking || mode === "preserve") {
    result += cleaned.slice(lastIndex);
  }

  return applyTrim(result, trimMode);
}
