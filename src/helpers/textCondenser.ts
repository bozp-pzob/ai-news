/**
 * Text condensing utilities for GitHub content.
 *
 * Strips token-wasting characters and patterns from GitHub markdown text
 * while preserving all semantic information. Designed to reduce LLM token
 * usage in the DailySummaryGenerator pipeline without truncating content.
 *
 * @module helpers/textCondenser
 */

/**
 * Condenses GitHub markdown text by removing token-wasting patterns
 * while preserving all semantic information.
 *
 * Transformations applied (in order):
 * 1. Strip HTML comments (template instructions, invisible to readers)
 * 2. Strip badge images (nested [![...](img)](link) patterns)
 * 3. Convert markdown images to alt text
 * 4. Strip HTML <img> tags, keeping alt text if present
 * 5. Condense markdown links to just the link text
 * 6. Strip remaining HTML tags, keeping inner content
 * 7. Simplify checkbox syntax
 * 8. Strip code fence language identifiers
 * 9. Remove horizontal rules and decorative underlines
 * 10. Trim trailing whitespace per line
 * 11. Collapse excessive blank lines
 *
 * @param text - Raw GitHub markdown text
 * @returns Condensed text with all semantic content preserved
 */
export function condenseGitHubText(text: string): string {
  if (!text) return text;

  let result = text;

  // 1. Strip HTML comments (PR/issue template instructions)
  //    e.g. <!-- Please describe your changes below -->
  result = result.replace(/<!--[\s\S]*?-->/g, '');

  // 2. Strip badge images: [![alt](image-url)](link-url)
  //    These are entirely decorative (CI status, coverage, etc.)
  result = result.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');

  // 3. Convert markdown images to alt text or remove if no alt
  //    ![screenshot](https://very-long-url...) -> [image: screenshot]
  //    ![](https://very-long-url...) -> (removed)
  result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => {
    const trimmed = alt.trim();
    return trimmed ? `[image: ${trimmed}]` : '';
  });

  // 4. Strip HTML <img> tags, keeping alt text if present
  //    <img src="..." alt="diagram" width="500" /> -> [image: diagram]
  result = result.replace(/<img\s[^>]*?alt\s*=\s*["']([^"']*)["'][^>]*\/?>/gi, (_match, alt: string) => {
    const trimmed = alt.trim();
    return trimmed ? `[image: ${trimmed}]` : '';
  });
  // Remove remaining <img> tags without alt text
  result = result.replace(/<img\s[^>]*\/?>/gi, '');

  // 5. Condense markdown links to just the link text
  //    [link text](https://very-long-url...) -> link text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 6. Strip remaining HTML tags, keeping inner content
  //    <details><summary>Info</summary>Content</details> -> Info Content
  //    <br>, <hr>, <sub>, <sup>, etc. -> removed
  result = result.replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\/?>/gi, '');

  // 7. Simplify checkbox syntax
  //    - [ ] Task -> - Task
  //    - [x] Task -> - [done] Task
  result = result.replace(/^(\s*[-*])\s*\[x\]\s+/gm, '$1 [done] ');
  result = result.replace(/^(\s*[-*])\s*\[ \]\s+/gm, '$1 ');

  // 8. Strip code fence language identifiers
  //    ```typescript -> ```
  result = result.replace(/^```\w+\s*$/gm, '```');

  // 9. Remove horizontal rules (--- or *** or ___ with 3+ chars)
  //    and decorative underlines (=== with 3+ chars)
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');
  result = result.replace(/^={3,}\s*$/gm, '');

  // 10. Trim trailing whitespace per line
  result = result.replace(/[ \t]+$/gm, '');

  // 11. Collapse 3+ consecutive newlines to 2 (single blank line)
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

/**
 * Condenses a unified diff hunk by keeping only meaningful change lines.
 *
 * Keeps:
 * - @@ header line (provides line number context)
 * - Lines starting with + (additions)
 * - Lines starting with - (deletions)
 *
 * Removes:
 * - Context lines (unchanged lines starting with space)
 *
 * @param diffHunk - Raw unified diff hunk from GitHub API
 * @returns Condensed diff with only the changed lines
 */
export function condenseDiffHunk(diffHunk: string): string {
  if (!diffHunk) return diffHunk;

  const lines = diffHunk.split('\n');
  const kept = lines.filter(line =>
    line.startsWith('@@') ||
    line.startsWith('+') ||
    line.startsWith('-')
  );

  return kept.join('\n').trim();
}
