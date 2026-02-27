/**
 * Prompt generation utilities for the Digital Gardener.
 * 
 * This module centralizes all prompt construction for AI models.
 * Design principles based on recent prompt engineering research:
 * - XML tags for clear data/instruction separation (Anthropic best practices)
 * - System/user message separation where possible (The Prompt Report, arXiv:2406.06608)
 * - Positive instructions over negative ("do X" instead of "don't do Y")
 * - Few-shot examples for structured output formats
 * - Directional stimulus cues to focus on relevant content
 * - Task-specific temperature recommendations
 * 
 * @module helpers
 */

import { RawPullRequest, RawIssue, RawCommit, DailyStats, ContributorStats, SummarizeOptions } from '../types';
import { MediaLookup } from "./mediaHelper";

/**
 * Options for prompt generation with media support
 */
export interface PromptMediaOptions {
  mediaLookup?: MediaLookup;
  dateStr?: string;
  maxImagesPerSource?: number;
  maxVideosPerSource?: number;
}
// ============================================
// SYSTEM PROMPTS (separated from user content)
// ============================================

/**
 * System prompt for markdown conversion tasks.
 * Separated from data per research showing system/user separation improves instruction following.
 */
export const SYSTEM_PROMPT_MARKDOWN_CONVERTER = `You are an expert at converting structured JSON data into concise markdown reports.

Your output must:
- Use clear, hierarchical headings and bullet lists for key points
- Be concise, well-structured, and easy to parse
- Include only accomplished work, concrete outcomes, and factual information
- Omit recommendations, suggestions, and commentary about absent or missing content
- Exclude any raw JSON from the output

Return only the final markdown text with no preamble or explanation.`;

/**
 * System prompt for topic summarization tasks.
 */
export const SYSTEM_PROMPT_TOPIC_SUMMARIZER = `You are an AI news aggregator that synthesizes source content into structured JSON summaries.

Your responsibilities:
- Summarize only the information provided in the source materials
- Use only facts, quotes, and data from the provided sources
- Combine related sources into cohesive summaries when they cover the same subject
- Preserve source attribution (links, images, videos) accurately
- Prioritize technical content, decisions, and concrete developments over speculation

Always respond with valid JSON matching the requested schema.`;

/**
 * System prompt for Discord channel analysis.
 * Used by both DiscordSummaryGenerator and DiscordChannelSource for consistency.
 */
export const SYSTEM_PROMPT_DISCORD_ANALYZER = `You are a technical community analyst that extracts structured insights from Discord conversations.

Your analysis priorities:
- Focus on technical discussions, decisions, and problem-solving over social chatter and greetings
- Identify concrete solutions, implementations, and actionable outcomes
- Attribute all quotes and actions to the exact Discord usernames from the chat
- Be specific and concise — prefer concrete details over vague summaries

Follow the exact output format specified in each request. Consistency in format is critical because the output is parsed programmatically.`;

/**
 * System prompt for GitHub daily/weekly summaries.
 */
export const SYSTEM_PROMPT_GITHUB_SUMMARIZER = `You are a development activity analyst that creates insightful summaries of GitHub repository activity.

Your analysis priorities:
- Emphasize the impact of changes on the project rather than listing raw statistics
- Focus on the "what" and "why" — explain what changed and why it matters
- Highlight patterns: areas of focus, active contributors, emerging discussions
- Include only accomplished work and concrete outcomes`;

/**
 * System prompt for daily Discord summary generation (combining channel summaries).
 */
export const SYSTEM_PROMPT_DISCORD_DAILY = `You are a technical community reporter that creates comprehensive daily digests from Discord channel summaries.

Your output must:
- Group discussions by theme rather than by channel
- Prioritize technical decisions, announcements, and concrete outcomes
- Preserve attribution to specific users when available
- Use markdown formatting effectively (headings, lists, bold text)
- Start directly with the markdown content — no preamble, explanations, or code block wrappers`;

// ============================================
// HTML ANALYSIS PROMPT
// ============================================

/**
 * System prompt for HTML/web page structured data extraction.
 * Used by HTMLParser for AI-guided content extraction from web pages.
 */
export const SYSTEM_PROMPT_HTML_ANALYZER = `You are a structured data extractor that analyzes web page content and returns structured JSON.

Your responsibilities:
- Extract all relevant data points from the provided page content
- Map extracted data to the requested TypeScript interface when provided
- Store any important data that doesn't fit the interface under a "misc" field
- Use only information present in the content — do not fabricate data
- Preserve URLs, dates, numbers, and other factual data exactly as found

Always respond with valid JSON matching the requested schema.`;

/**
 * Creates a prompt for analyzing web page content and extracting structured data.
 * 
 * Uses XML tags for clear data/instruction separation, consistent with the
 * rest of the prompt system.
 * 
 * Recommended options: { systemPrompt: SYSTEM_PROMPT_HTML_ANALYZER, temperature: 0.3, jsonMode: true }
 * 
 * @param markdown - The page content converted to markdown
 * @param objectTypeString - Optional TypeScript interface for the desired output structure
 * @param excludeTopics - Optional topics to exclude from extraction
 * @returns A formatted user prompt string
 */
export function createHtmlAnalysisPrompt(
  markdown: string,
  objectTypeString?: string,
  excludeTopics?: string,
): string {
  let prompt = `Analyze this web page content and extract all relevant structured data.

<page_content>
${markdown}
</page_content>`;

  if (objectTypeString) {
    prompt += `

Map the extracted data to this TypeScript interface:

<output_schema>
${objectTypeString}
</output_schema>

If there are important data points that don't fit the structured interface, include them under a "misc" field.`;
  } else {
    prompt += `

Extract the data as a JSON object with these fields:
- "title": The page title or main heading
- "description": A concise summary of the page content (2-3 sentences)
- "text": The main body text content
- "author": Author name if available
- "date": Publication or last modified date if available (ISO 8601 format)
- "tags": Array of relevant topic tags
- "misc": Any other noteworthy structured data found on the page`;
  }

  if (excludeTopics) {
    prompt += `

Exclude these topics from the extraction: ${excludeTopics}`;
  }

  prompt += `

Return the analysis as a valid JSON object.`;

  return prompt;
}

// ============================================
// PARSER GENERATION PROMPTS
// ============================================

/**
 * System prompt for LLM-based parser code generation.
 * Instructs the LLM to produce a reusable JavaScript function body
 * that uses cheerio's $ to extract structured data from HTML.
 */
export const SYSTEM_PROMPT_PARSER_GENERATOR = `You are a code generator that creates reusable JavaScript parser functions for extracting structured data from HTML pages.

Your output is a JavaScript function BODY (not a full function declaration) that will be executed as:
  (function($) { <your code> })($)
where $ is a cheerio-loaded document (jQuery-like API).

CRITICAL RULES — your code MUST follow this exact pattern:

1. Start by declaring: var result = {};
2. Wrap EVERY field extraction in its own try-catch:
   try { result.title = $('h1').first().text().trim(); } catch(e) { result.title = null; }
   try { result.price = $('[data-testid="price"]').text().trim(); } catch(e) { result.price = null; }
3. End with: return result;

DEFENSIVE CODING — these cause crashes, NEVER do them:
- NEVER call .split(), .match(), .replace() etc. on a value without checking it first:
  BAD:  result.zip = $('span').text().split(',')[1].trim()
  GOOD: try { var addr = $('span').text() || ''; var parts = addr.split(','); result.zip = parts[1] ? parts[1].trim() : null; } catch(e) { result.zip = null; }
- NEVER chain .text().trim() on a selector that might match nothing — always use .first() or check .length
- NEVER assume array indices exist — always check: parts[1] ? parts[1].trim() : null

CHEERIO TIPS:
- Use: $('selector'), .find(), .text(), .attr(), .map(), .each(), .first(), .last(), .eq(), .children(), .parent(), .closest(), .filter()
- Be SPECIFIC — use class names, IDs, data attributes, and element hierarchy you observe
- Parse dates into ISO 8601 format when possible
- Clean whitespace: .text().trim().replace(/\\s+/g, ' ')

FORBIDDEN:
- Do NOT use require(), fetch(), import, process, fs, or any I/O
- Do NOT use async/await or Promises
- Do NOT output explanations, comments, or markdown — ONLY JavaScript code

Always respond with ONLY the JavaScript function body code.`;

/**
 * Creates a prompt asking the LLM to generate a cheerio-based parser function.
 *
 * @param markdown - Page content as markdown (for LLM readability)
 * @param structureHints - HTML structural hints (CSS classes, IDs, repeated patterns)
 * @param objectTypeString - Optional TypeScript interface for desired output schema
 * @param structuredDataHint - Optional already-extracted structured data (JSON-LD, OG tags)
 * @returns Prompt string
 */
export function createParserGenerationPrompt(
  markdown: string,
  structureHints: string,
  objectTypeString?: string,
  structuredDataHint?: Record<string, any>,
): string {
  let prompt = `Generate a JavaScript function body that extracts structured data from this web page using cheerio ($).

<page_content>
${markdown.substring(0, 8000)}
</page_content>

<html_structure>
${structureHints}
</html_structure>`;

  if (structuredDataHint && Object.keys(structuredDataHint).length > 0) {
    prompt += `

<already_extracted_data>
${JSON.stringify(structuredDataHint, null, 2).substring(0, 2000)}
</already_extracted_data>

The above data was already extracted for free from JSON-LD and meta tags. Your parser should extract ADDITIONAL data beyond what is available in meta tags, using the actual page HTML structure.`;
  }

  if (objectTypeString) {
    prompt += `

Map the extracted data to this TypeScript interface:

<output_schema>
${objectTypeString}
</output_schema>

Include a "misc" field for important data that does not fit the interface.`;
  } else {
    prompt += `

Extract a JSON object with these fields:
- "title": The page title or main heading
- "description": A concise summary (2-3 sentences)
- "text": The main body text content
- "author": Author name if available
- "date": Publication date in ISO 8601 format if available
- "tags": Array of relevant topic tags
- "misc": Any other noteworthy structured data`;
  }

  prompt += `

Remember: Return ONLY the JavaScript function body code. The function receives $ (cheerio) and must return the data object. No markdown fences, no function declaration wrapper.`;

  return prompt;
}

/**
 * Creates a retry prompt when a generated parser failed validation.
 * Includes the previous code and what fields were missing.
 */
export function createParserRetryPrompt(
  markdown: string,
  structureHints: string,
  previousCode: string,
  missingFields: string[],
  objectTypeString?: string,
): string {
  let prompt = `The previous parser function failed to extract some required fields. Fix it.

<page_content>
${markdown.substring(0, 6000)}
</page_content>

<html_structure>
${structureHints}
</html_structure>

<previous_parser_code>
${previousCode}
</previous_parser_code>

<missing_fields>
${missingFields.join(', ')}
</missing_fields>

The above fields were missing or empty in the parser output. Examine the page content and HTML structure carefully to find where these fields can be extracted from.`;

  if (objectTypeString) {
    prompt += `

Target schema:

<output_schema>
${objectTypeString}
</output_schema>`;
  }

  prompt += `

Return ONLY the corrected JavaScript function body code. No markdown fences, no function declaration wrapper.`;

  return prompt;
}

// ============================================
// PARSER FROM EXAMPLE PROMPT (gold-standard)
// ============================================

/**
 * Creates a prompt that gives the LLM both the HTML data sources and the expected
 * JSON output, asking it to write a cheerio parser that reproduces that output.
 *
 * This is "programming by example" — the LLM sees the concrete input-output pair
 * and writes the transformation code.
 *
 * @param embeddedDataSummary - Summary of data in script tags (from extractEmbeddedData)
 * @param goldStandard - The correctly extracted JSON from direct LLM extraction
 * @param objectTypeString - Optional TypeScript interface for context
 * @returns Prompt string
 */
export function createParserFromExamplePrompt(
  embeddedDataSummary: string,
  goldStandard: Record<string, any>,
  objectTypeString?: string,
): string {
  const goldJson = JSON.stringify(goldStandard, null, 2).substring(0, 6000);

  let prompt = `Write a JavaScript function body using cheerio ($) that extracts data from an HTML page.

Below is the CORRECT JSON output that was extracted from this page. Your parser must reproduce this output as closely as possible.

<expected_output>
${goldJson}
</expected_output>

Below are the DATA SOURCES available in the HTML. Look for data in these script tags FIRST — they contain structured data that is more reliable than scraping visible DOM text.

<embedded_data_sources>
${embeddedDataSummary}
</embedded_data_sources>`;

  if (objectTypeString) {
    prompt += `

For context, here is the TypeScript interface the output should conform to:

<output_schema>
${objectTypeString}
</output_schema>`;
  }

  prompt += `

STRATEGY — follow this priority order:
1. FIRST check <script id="__NEXT_DATA__"> or similar hydration data — parse the JSON and extract fields directly. This is the most reliable source.
2. THEN check <script type="application/ld+json"> for structured data.
3. ONLY use DOM selectors (text, attributes) for fields not available in script data.

IMPORTANT: The function body receives $ (cheerio-loaded document). Follow the defensive coding pattern from the system prompt. Return ONLY JavaScript code, no explanations.`;

  return prompt;
}

// ============================================
// TOPIC EXTRACTION PROMPT (centralized)
// ============================================

/**
 * Creates a system/user prompt pair for topic extraction.
 * Centralized here to eliminate duplication between OpenAIProvider and OpenRouterProvider.
 * Fixed: dangling quote bug from the original inline prompt.
 * 
 * @param text - Text to analyze for topics
 * @returns Object with systemPrompt and userPrompt for proper message separation
 */
export function createTopicsPrompt(text: string): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You extract topic keywords from text. Return a JSON array of up to 6 single-word or short-phrase topic labels that describe the main subjects of the text. Use lowercase. Respond with only the JSON array, no other text.

Example response: ["machine-learning", "deployment", "api-design", "performance"]`,
    userPrompt: `Extract topics from the following text:\n\n<text>\n${text}\n</text>`
  };
}

// ============================================
// MARKDOWN & JSON PROMPT BUILDERS
// ============================================

/**
 * Creates a prompt for converting JSON summary data into markdown format.
 * 
 * Improvements over original:
 * - Data wrapped in XML <data> tags for clear boundary separation
 * - Positive instructions replace "DO NOT" clauses
 * - System prompt separated (available via SYSTEM_PROMPT_MARKDOWN_CONVERTER)
 * 
 * Recommended options: { systemPrompt: SYSTEM_PROMPT_MARKDOWN_CONVERTER, temperature: 0.3 }
 * 
 * @param summaryData - The JSON data to be converted to markdown
 * @param dateStr - The date string associated with the summary data
 * @returns A formatted user prompt string
 */
export const createMarkdownPromptForJSON = (summaryData: any, dateStr: string): string => {
  const jsonStr = JSON.stringify(summaryData, null, 2);
  return `Convert the following JSON summary for ${dateStr} into a markdown report.

<data>
${jsonStr}
</data>

Return only the final markdown text.`;
}

/**
 * Creates a prompt for generating a JSON summary of topics from content items.
 * 
 * Improvements over original:
 * - XML <sources>/<source> tags replace ***source*** delimiters
 * - Explicit JSON schema example (few-shot) for format compliance
 * - System prompt separated (available via SYSTEM_PROMPT_TOPIC_SUMMARIZER)
 * - Anti-hallucination instruction uses positive framing
 * 
 * Recommended options: { systemPrompt: SYSTEM_PROMPT_TOPIC_SUMMARIZER, temperature: 0.4, jsonMode: true }
 * 
 * @param topic - The topic to summarize
 * @param objects - Array of content items related to the topic
 * @param dateStr - The date string associated with the content
 * @returns A formatted user prompt string
 */
export const createJSONPromptForTopics = (topic: string, objects: any[], dateStr: string): string => {
  let sourcesXml = '';
  
  objects.forEach((item) => {
    sourcesXml += `  <source>\n`;
    if (item.text) sourcesXml += `    <text>${item.text}</text>\n`;
    if (item.link) sourcesXml += `    <link>${item.link}</link>\n`;
    if (item.metadata?.photos) sourcesXml += `    <photos>${item.metadata.photos}</photos>\n`;
    if (item.metadata?.videos) sourcesXml += `    <videos>${item.metadata.videos}</videos>\n`;
    sourcesXml += `  </source>\n`;
  });

  return `Generate a JSON summary for the topic "${topic}" on ${dateStr}.

<sources>
${sourcesXml}</sources>

Summarize the content using only information from the sources above. Combine related sources into cohesive summaries when they cover the same subject.

Respond with a valid JSON object matching this schema:

<output_format>
{
  "title": "Topic Title",
  "content": [
    {
      "text": "Summary paragraph synthesizing the key points from the sources.",
      "sources": "https://source-url-1, https://source-url-2",
      "images": [],
      "videos": []
    }
  ]
}
</output_format>`;
}

// ============================================
// DISCORD PROMPT BUILDERS (unified)
// ============================================

/**
 * Creates a prompt for analyzing a Discord channel's chat transcript.
 * 
 * This is the unified version used by both DiscordSummaryGenerator and DiscordChannelSource.
 * The output is parsed programmatically by parseFAQs(), parseHelpInteractions(), and
 * parseActionItems() using regex, so format compliance is critical.
 * 
 * Improvements over original:
 * - XML <transcript> tags replace --- delimiters for clear data boundaries
 * - Few-shot format examples ensure regex-parseable output
 * - Directional stimulus: prioritizes technical content
 * - System prompt separated (available via SYSTEM_PROMPT_DISCORD_ANALYZER)
 * 
 * Recommended options: { systemPrompt: SYSTEM_PROMPT_DISCORD_ANALYZER, temperature: 0.3 }
 * 
 * @param transcript - The chat transcript text
 * @param channelName - Optional channel name for context
 * @returns A formatted user prompt string
 */
export function createDiscordAnalysisPrompt(transcript: string, channelName?: string): string {
  const channelContext = channelName ? ` for channel "${channelName}"` : '';
  
  return `Analyze this Discord chat segment${channelContext} and provide a structured analysis in exactly 4 numbered sections.

<transcript>
${transcript}
</transcript>

<output_format>
1. Summary (max 500 words):
- Focus on the most important technical discussions, decisions, and problem-solving
- Highlight concrete solutions and implementations
- Be specific and concise

2. FAQ (max 20 questions):
List each Q&A pair on its own line using this exact format:
Q: <Question> (asked by <User>) A: <Answer> (answered by <User>)
For unanswered questions use:
Q: <Question> (asked by <User>) A: Unanswered

Example:
Q: How do I configure the Discord bot token? (asked by alice) A: Set DISCORD_TOKEN in your .env file (answered by bob)
Q: Is there a rate limit on the API? (asked by charlie) A: Unanswered

Only include significant questions with meaningful responses. Use exact Discord usernames from the chat.

3. Help Interactions (max 10):
List each interaction on its own line using this exact format:
Helper: <User> | Helpee: <User> | Context: <Problem> | Resolution: <Solution>

Example:
Helper: bob | Helpee: alice | Context: Bot not connecting to Discord gateway | Resolution: Identified missing DISCORD_TOKEN env variable and helped configure it

Be specific about the problem and whether it was resolved.

4. Action Items (max 20 total):
List each item on its own line using this exact format:
Type: <Technical|Documentation|Feature> | Description: <Description> | Mentioned By: <User>

Example:
Type: Technical | Description: Fix WebSocket reconnection logic for Discord bot | Mentioned By: alice
Type: Documentation | Description: Add setup guide for new contributors | Mentioned By: bob

Include only critical tasks, essential documentation needs, and major feature suggestions.
</output_format>

Return the analysis using the numbered sections (1., 2., 3., 4.) and the exact line formats shown above. Each FAQ, Help Interaction, and Action Item must be on its own line.`;
}

/**
 * Creates a prompt for combining channel summaries into a daily Discord digest.
 * 
 * Recommended options: { systemPrompt: SYSTEM_PROMPT_DISCORD_DAILY, temperature: 0.4 }
 * 
 * @param channelSummaries - Array of { guildName, channelName, summary } objects
 * @param dateStr - The date string
 * @returns A formatted user prompt string
 */
export function createDiscordDailySummaryPrompt(
  channelSummaries: Array<{ guildName: string; channelName: string; summary: string }>,
  dateStr: string
): string {
  const summariesXml = channelSummaries
    .map(s => `  <channel guild="${s.guildName}" name="${s.channelName}">\n${s.summary}\n  </channel>`)
    .join('\n');

  return `Create a comprehensive daily markdown summary of Discord discussions from ${dateStr}.

<channel_summaries>
${summariesXml}
</channel_summaries>

Structure the output covering these points across all channels:
1. **Overall Discussion Highlights:** Key topics, technical decisions, and announcements. Group by theme rather than by channel.
2. **Key Questions & Answers:** List significant questions that received answers.
3. **Community Help & Collaboration:** Showcase important instances of users helping each other.
4. **Action Items:** Consolidate all action items, grouped by type (Technical, Documentation, Feature). Include attribution (mentioned by).

Use markdown formatting effectively (headings, lists, bold text). Output the markdown directly with no preamble or code block wrappers.`;
}

// ============================================
// GITHUB PROMPT FORMATTERS
// ============================================

/**
 * Format pull requests for AI context
 */
export function formatPullRequestsForPrompt(prs: RawPullRequest[]): string {
  if (prs.length === 0) return 'No pull requests.';
  
  return prs.map(pr => {
    const author = pr.author?.login || 'unknown';
    const state = pr.merged ? 'MERGED' : pr.state;
    const labels = pr.labels?.nodes.map(l => l.name).join(', ') || 'none';
    const reviewCount = pr.reviews?.nodes.length || 0;
    const commentCount = pr.comments?.nodes.length || 0;
    
    return `- #${pr.number}: "${pr.title}" by @${author}
  State: ${state} | Labels: ${labels}
  Changes: +${pr.additions}/-${pr.deletions} in ${pr.changedFiles} files
  Reviews: ${reviewCount} | Comments: ${commentCount}
  ${pr.body ? `Description: ${pr.body.slice(0, 200)}${pr.body.length > 200 ? '...' : ''}` : ''}`;
  }).join('\n\n');
}

/**
 * Format issues for AI context
 */
export function formatIssuesForPrompt(issues: RawIssue[]): string {
  if (issues.length === 0) return 'No issues.';
  
  return issues.map(issue => {
    const author = issue.author?.login || 'unknown';
    const labels = issue.labels?.nodes.map(l => l.name).join(', ') || 'none';
    const commentCount = issue.comments?.nodes.length || 0;
    
    return `- #${issue.number}: "${issue.title}" by @${author}
  State: ${issue.state} | Labels: ${labels}
  Comments: ${commentCount}
  ${issue.body ? `Description: ${issue.body.slice(0, 200)}${issue.body.length > 200 ? '...' : ''}` : ''}`;
  }).join('\n\n');
}

/**
 * Format commits for AI context
 */
export function formatCommitsForPrompt(commits: RawCommit[]): string {
  if (commits.length === 0) return 'No commits.';
  
  // Group by author for cleaner summary
  const byAuthor = new Map<string, RawCommit[]>();
  for (const commit of commits) {
    const author = commit.author?.user?.login || commit.author?.name || 'unknown';
    if (!byAuthor.has(author)) {
      byAuthor.set(author, []);
    }
    byAuthor.get(author)!.push(commit);
  }
  
  return Array.from(byAuthor.entries()).map(([author, authorCommits]) => {
    const totalAdditions = authorCommits.reduce((sum, c) => sum + c.additions, 0);
    const totalDeletions = authorCommits.reduce((sum, c) => sum + c.deletions, 0);
    
    return `@${author} (${authorCommits.length} commits, +${totalAdditions}/-${totalDeletions}):
${authorCommits.slice(0, 5).map(c => `  - ${c.messageHeadline || c.message.split('\n')[0]}`).join('\n')}${authorCommits.length > 5 ? `\n  ... and ${authorCommits.length - 5} more` : ''}`;
  }).join('\n\n');
}

/**
 * Format contributor stats for AI context
 */
export function formatContributorStatsForPrompt(contributors: ContributorStats[]): string {
  if (contributors.length === 0) return 'No contributor activity.';
  
  // Sort by total activity
  const sorted = [...contributors].sort((a, b) => {
    const aTotal = a.prsOpened + a.prsMerged + a.issuesOpened + a.commits + a.reviews + a.comments;
    const bTotal = b.prsOpened + b.prsMerged + b.issuesOpened + b.commits + b.reviews + b.comments;
    return bTotal - aTotal;
  });
  
  return sorted.slice(0, 10).map((c, i) => {
    const activities: string[] = [];
    if (c.prsOpened > 0) activities.push(`${c.prsOpened} PRs opened`);
    if (c.prsMerged > 0) activities.push(`${c.prsMerged} PRs merged`);
    if (c.issuesOpened > 0) activities.push(`${c.issuesOpened} issues`);
    if (c.commits > 0) activities.push(`${c.commits} commits`);
    if (c.reviews > 0) activities.push(`${c.reviews} reviews`);
    if (c.comments > 0) activities.push(`${c.comments} comments`);
    
    return `${i + 1}. @${c.username}: ${activities.join(', ')} (+${c.additions}/-${c.deletions})`;
  }).join('\n');
}

// ============================================
// GITHUB SUMMARY PROMPT BUILDERS
// ============================================

/**
 * Generate daily summary prompt.
 * 
 * Improvements:
 * - Data wrapped in XML tags for clear boundaries
 * - Directional stimulus: emphasize impact over statistics
 * - System prompt separated (available via SYSTEM_PROMPT_GITHUB_SUMMARIZER)
 * 
 * Recommended options: { systemPrompt: SYSTEM_PROMPT_GITHUB_SUMMARIZER, temperature: 0.4 }
 */
export function generateDailySummaryPrompt(
  repository: string,
  date: string,
  prs: RawPullRequest[],
  issues: RawIssue[],
  commits: RawCommit[],
  stats: DailyStats,
): string {
  return `Analyze the following GitHub activity and provide a comprehensive daily summary.

<activity repository="${repository}" date="${date}">
  <statistics>
    Pull Requests Opened: ${stats.prsOpened}
    Pull Requests Merged: ${stats.prsMerged}
    Pull Requests Closed: ${stats.prsClosed}
    Issues Opened: ${stats.issuesOpened}
    Issues Closed: ${stats.issuesClosed}
    Commits: ${stats.commits}
    Active Contributors: ${stats.activeContributors.length}
  </statistics>

  <top_contributors>
${formatContributorStatsForPrompt(stats.contributors)}
  </top_contributors>

  <pull_requests>
${formatPullRequestsForPrompt(prs)}
  </pull_requests>

  <issues>
${formatIssuesForPrompt(issues)}
  </issues>

  <commits>
${formatCommitsForPrompt(commits)}
  </commits>
</activity>

Provide a summary with these sections:
1. **Overview**: A 2-3 sentence high-level summary of the day's development activity
2. **Key Changes**: Notable features, improvements, or bug fixes (bullet points)
3. **Areas of Focus**: What parts of the codebase saw the most activity
4. **Active Contributors**: Brief mention of who was most active and what they worked on
5. **Notable Discussions**: Any significant issues or PR discussions worth highlighting

Keep the summary informative but concise (max 400 words). Emphasize the impact of changes on the project rather than restating raw statistics.`;
}

/**
 * Generate weekly summary prompt.
 * 
 * Recommended options: { systemPrompt: SYSTEM_PROMPT_GITHUB_SUMMARIZER, temperature: 0.4 }
 */
export function generateWeeklySummaryPrompt(
  repository: string,
  startDate: string,
  endDate: string,
  stats: DailyStats,
  topPRs: RawPullRequest[],
  topIssues: RawIssue[],
): string {
  return `Analyze the following GitHub activity and provide a comprehensive weekly summary.

<activity repository="${repository}" period="${startDate} to ${endDate}">
  <statistics>
    Pull Requests Opened: ${stats.prsOpened}
    Pull Requests Merged: ${stats.prsMerged}
    Issues Opened: ${stats.issuesOpened}
    Issues Closed: ${stats.issuesClosed}
    Commits: ${stats.commits}
    Active Contributors: ${stats.activeContributors.length}
  </statistics>

  <top_contributors>
${formatContributorStatsForPrompt(stats.contributors)}
  </top_contributors>

  <notable_pull_requests>
${formatPullRequestsForPrompt(topPRs.slice(0, 10))}
  </notable_pull_requests>

  <notable_issues>
${formatIssuesForPrompt(topIssues.slice(0, 10))}
  </notable_issues>
</activity>

Provide a weekly summary with these sections:
1. **Week in Review**: 3-4 sentence overview of the week's development progress
2. **Major Accomplishments**: Key features shipped, important bugs fixed
3. **Ongoing Work**: What's in progress or under review
4. **Community Activity**: Contributor highlights, new contributors
5. **Looking Ahead**: Any planned work or open questions for next week

Keep the summary informative and actionable (max 500 words). Emphasize the impact and significance of changes rather than restating statistics.`;
}

/**
 * Generate a simple text summary for the AiProvider.summarize() method.
 * Used by GitHubSource for lightweight summarization.
 */
export function generateSummarizeInput(
  repository: string,
  date: string,
  prs: RawPullRequest[],
  issues: RawIssue[],
  commits: RawCommit[],
): string {
  const prSummary = prs.length > 0 
    ? `${prs.length} pull requests (${prs.filter(p => p.merged).length} merged): ${prs.slice(0, 3).map(p => p.title).join('; ')}`
    : 'No pull requests';
    
  const issueSummary = issues.length > 0
    ? `${issues.length} issues: ${issues.slice(0, 3).map(i => i.title).join('; ')}`
    : 'No issues';
    
  const commitSummary = commits.length > 0
    ? `${commits.length} commits from ${new Set(commits.map(c => c.author?.user?.login || c.author?.name)).size} contributors`
    : 'No commits';

  return `GitHub Activity Summary for ${repository} on ${date}:

${prSummary}

${issueSummary}

${commitSummary}

Key changes: ${prs.filter(p => p.merged).slice(0, 5).map(p => p.title).join(', ') || 'None'}`;
}

// ============================================
// PROMPT OPTIONS HELPERS
// ============================================

/**
 * Pre-built SummarizeOptions for common use cases.
 * Callers can spread these into their summarize() calls.
 */
export const SUMMARIZE_OPTIONS = {
  /** For converting JSON to markdown reports */
  markdownConversion: {
    systemPrompt: SYSTEM_PROMPT_MARKDOWN_CONVERTER,
    temperature: 0.3,
  } as SummarizeOptions,

  /** For generating topic JSON summaries */
  topicSummary: {
    systemPrompt: SYSTEM_PROMPT_TOPIC_SUMMARIZER,
    temperature: 0.4,
    jsonMode: true,
  } as SummarizeOptions,

  /** For analyzing Discord channel transcripts */
  discordAnalysis: {
    systemPrompt: SYSTEM_PROMPT_DISCORD_ANALYZER,
    temperature: 0.3,
  } as SummarizeOptions,

  /** For generating daily Discord digests */
  discordDailySummary: {
    systemPrompt: SYSTEM_PROMPT_DISCORD_DAILY,
    temperature: 0.4,
  } as SummarizeOptions,

  /** For GitHub daily/weekly summaries */
  githubSummary: {
    systemPrompt: SYSTEM_PROMPT_GITHUB_SUMMARIZER,
    temperature: 0.4,
  } as SummarizeOptions,

  /** For HTML/web page structured data extraction */
  htmlAnalysis: {
    systemPrompt: SYSTEM_PROMPT_HTML_ANALYZER,
    temperature: 0.3,
    jsonMode: true,
  } as SummarizeOptions,

  /** For generating reusable HTML parser code */
  parserGeneration: {
    systemPrompt: SYSTEM_PROMPT_PARSER_GENERATOR,
    temperature: 0.2,
  } as SummarizeOptions,
} as const;
