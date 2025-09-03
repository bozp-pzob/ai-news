import * as cheerio from "cheerio";

/**
 * Prompt generation utilities for the AI News Aggregator.
 * This module provides functions for creating prompts for AI models.
 * 
 * @module helpers
 */

/**
 * Creates a prompt for converting JSON summary data into markdown format.
 * 
 * This function:
 * 1. Takes JSON summary data and a date string
 * 2. Formats a prompt that instructs an AI model to convert the JSON into markdown
 * 3. Includes specific guidelines for the markdown format
 * 
 * @param summaryData - The JSON data to be converted to markdown
 * @param dateStr - The date string associated with the summary data
 * @returns A formatted prompt string for the AI model
 */
export const createMarkdownPromptForJSON = (summaryData: any, dateStr: string): string => {
  const jsonStr = JSON.stringify(summaryData, null, 2);
  return `You are an expert at converting structured JSON data into a concise markdown report for language model processing.
  
The markdown should:
- Use clear, hierarchical headings
- Include bullet lists for key points
- Be concise and easy to parse
- Exclude any raw JSON output
- Maintain hierarchical structure
- Focus on key information
- ONLY report on what has been done or accomplished
- DO NOT include statements about what is missing, not done, or needs improvement
- DO NOT include recommendations or suggestions
- DO NOT include phrases like "no technical discussions" or "limited content"

Given the following JSON summary for ${dateStr}, generate a markdown report accordingly:

${jsonStr}

Only return the final markdown text.`;
}

/**
 * Creates a prompt for generating a JSON summary of topics from content items.
 * 
 * This function:
 * 1. Takes a topic, an array of content items, and a date string
 * 2. Formats a prompt that instructs an AI model to generate a JSON summary
 * 3. Includes the content items with their text, links, and media
 * 4. Specifies the required JSON structure for the response
 * 
 * @param topic - The topic to summarize
 * @param objects - Array of content items related to the topic
 * @param dateStr - The date string associated with the content
 * @returns A formatted prompt string for the AI model
 */
export const createJSONPromptForTopics = (topic: string, objects: any[], dateStr: string): string => {
  let prompt = `Generate a summary for the topic. Focus on the following details:\n\n`;
  objects.forEach((item) => {
    prompt += `\n***source***\n`;
    if (item.text) prompt += `text: ${item.text}\n`;
    if (item.link) prompt += `sources: ${item.link}\n`;
    if (item.metadata?.photos) prompt += `photos: ${item.metadata?.photos}\n`;
    if (item.metadata?.videos) prompt += `videos: ${item.metadata?.videos}\n`;
    prompt += `\n***source_end***\n\n`;
  });

  prompt += `Provide a clear and concise summary based on the ***sources*** above for the topic. DO NOT PULL DATA FROM OUTSIDE SOURCES'${topic}'. Combine similar sources into a longer summary if it makes sense.\n\n`;

  prompt += `Response MUST be a valid JSON object containing:\n- 'title': The title of the topic.\n- 'content': A list of messages with keys 'text', 'sources', 'images', and 'videos'.\n\n`;

  return prompt;
}

export const cleanHTML = (rawHTML: string): string => {
  const MAX_SCRIPT_CHARS = 10000; // adjust as needed
  
  //@ts-ignore
  const $ = cheerio.load(rawHTML, { decodeEntities: false });

  // 1) Extract all <script type="application/ld+json"> blocks.
  const jsonLdBlocks: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const inner = $(el).html();
    if (inner && inner.trim()) {
      jsonLdBlocks.push(inner.trim());
    }
  });
  // Remove JSON‑LD tags from the DOM now.
  $('script[type="application/ld+json"]').remove();

  // 2) Collect every other <script> if it’s small enough; drop the rest.
  const keptScriptContents: string[] = [];
  $('script').each((_, el) => {
    const inner = $(el).html() || '';
    const trimmed = inner.trim();
    if (trimmed && trimmed.length <= MAX_SCRIPT_CHARS) {
      keptScriptContents.push(trimmed);
    }
  });
  // Remove all remaining <script> tags from the DOM.
  $('script').remove();

  // 3) Remove redundant chrome: header, footer, style, noscript, iframe.
  $('header, footer, style, noscript, iframe').remove();

  // Helper: escape triple‑backticks so fences don’t break
  function escapeBackticks(text: string): string {
    return text.replace(/```/g, '\\`\\`\\`');
  }

  // Convert a <table> → Markdown
  //@ts-ignore
  function tableToMarkdown(tableElem: cheerio.Element): string {
    const rows: string[][] = [];
    const $table = $(tableElem);

    $table.find('tr').each((_, tr) => {
      const cells: string[] = [];
      $(tr)
        .find('th, td')
        .each((_, cell) => {
          const txt = $(cell).text().replace(/\s+/g, ' ').trim();
          cells.push(txt);
        });
      if (cells.length) {
        rows.push(cells);
      }
    });

    if (!rows.length) return '';

    const header = rows[0];
    const colCount = header.length;
    const separator = header.map(() => '---');

    const mdLines: string[] = [];
    mdLines.push(`| ${header.join(' | ')} |`);
    mdLines.push(`| ${separator.join(' | ')} |`);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i].slice();
      while (row.length < colCount) row.push('');
      mdLines.push(`| ${row.join(' | ')} |`);
    }
    return mdLines.join('\n');
  }

  // 4) Recursively convert any node to Markdown
  //@ts-ignore
  function nodeToMarkdown(node: cheerio.Element, indentLevel = 0): string {
    if (node.type === 'text') {
      const raw = (node.data || '').replace(/\s+/g, ' ').trim();
      return raw ? raw : '';
    }
    if (node.type !== 'tag') {
      return '';
    }

    const tag = node.tagName.toLowerCase();
    const $node = $(node);

    switch (tag) {
      case 'h1': {
        const txt = $node.text().replace(/\s+/g, ' ').trim();
        return txt ? `# ${txt}\n\n` : '';
      }
      case 'h2': {
        const txt = $node.text().replace(/\s+/g, ' ').trim();
        return txt ? `## ${txt}\n\n` : '';
      }
      case 'h3': {
        const txt = $node.text().replace(/\s+/g, ' ').trim();
        return txt ? `### ${txt}\n\n` : '';
      }
      case 'h4': {
        const txt = $node.text().replace(/\s+/g, ' ').trim();
        return txt ? `#### ${txt}\n\n` : '';
      }
      case 'h5': {
        const txt = $node.text().replace(/\s+/g, ' ').trim();
        return txt ? `##### ${txt}\n\n` : '';
      }
      case 'h6': {
        const txt = $node.text().replace(/\s+/g, ' ').trim();
        return txt ? `###### ${txt}\n\n` : '';
      }

      case 'ul':
      case 'ol': {
        const lines: string[] = [];
        const isOrdered = tag === 'ol';
        let counter = 1;
        $node.children('li').each((_, li) => {
          const liMd = nodeToMarkdown(li, indentLevel + 1).trim();
          if (!liMd) return;
          const prefix = isOrdered ? `${counter++}. ` : '- ';
          const indentSpaces = '  '.repeat(indentLevel);
          liMd.split('\n').forEach((subLine, idx) => {
            if (idx === 0) {
              lines.push(`${indentSpaces}${prefix}${subLine}`);
            } else {
              lines.push(`${indentSpaces}   ${subLine}`);
            }
          });
        });
        return lines.length ? lines.join('\n') + '\n\n' : '';
      }
      case 'li': {
        const parts: string[] = [];
        //@ts-ignore
        node.children.forEach((child: cheerio.Element) => {
          const md = nodeToMarkdown(child, indentLevel);
          if (md) parts.push(md);
        });
        return parts.join(' ').trim();
      }

      case 'p':
      case 'div':
      case 'section':
      case 'article':
      case 'span':
      case 'blockquote':
      case 'figure':
      case 'figcaption':
      case 'details':
      case 'summary': {
        let prefix = '';
        let suffix = '';
        if (tag === 'strong' || tag === 'b') {
          prefix = suffix = '**';
        } else if (tag === 'em' || tag === 'i' || tag === 'u') {
          prefix = suffix = '_';
        }
        const parts: string[] = [];
        //@ts-ignore
        node.children.forEach((child: cheerio.Element) => {
          const md = nodeToMarkdown(child, indentLevel);
          if (md) parts.push(md);
        });
        const combined = parts.join('').trim();
        return combined ? `${prefix}${combined}${suffix}` : '';
      }

      case 'br': {
        return '  \n';
      }

      case 'code': {
        const txt = $node.text();
        const esc = escapeBackticks(txt);
        return `\`${esc.trim()}\``;
      }

      case 'pre': {
        let codeText = '';
        if ($node.children('code').length) {
          codeText = $node.children('code').text();
        } else {
          codeText = $node.text();
        }
        const esc = escapeBackticks(codeText);
        return `\`\`\`\n${esc}\n\`\`\`\n\n`;
      }

      case 'table': {
        const mdTable = tableToMarkdown(node);
        return mdTable ? mdTable + '\n\n' : '';
      }
      case 'thead':
      case 'tbody':
      case 'tfoot':
      case 'tr':
      case 'th':
      case 'td': {
        return '';
      }

      case 'img': {
        const alt = $node.attr('alt') || '';
        const src = $node.attr('src') || '';
        if (alt.trim()) {
          return `![${alt.trim()}](${src.trim()})`;
        } else if (src.trim()) {
          return `![](${src.trim()})`;
        }
        return '';
      }

      case 'a': {
        const href = $node.attr('href') || '';
        const parts: string[] = [];
        //@ts-ignore
        node.children.forEach((child: cheerio.Element) => {
          const md = nodeToMarkdown(child, indentLevel);
          if (md) parts.push(md);
        });
        const text = parts.join('').trim() || href;
        return href ? `[${text}](${href.trim()})` : text;
      }

      default: {
        const parts: string[] = [];
        //@ts-ignore
        node.children.forEach((child: cheerio.Element) => {
          const md = nodeToMarkdown(child, indentLevel);
          if (md) parts.push(md);
        });
        return parts.join('').trim();
      }
    }
  }

  // 5) Build the final Markdown string:
  let result = '';

  // 5a) Emit JSON‑LD first
  if (jsonLdBlocks.length) {
    result += '```json\n';
    jsonLdBlocks.forEach((blk) => {
      result += blk.trim() + '\n';
    });
    result += '```\n\n';
  }

  // 5b) Traverse the DOM (minus header/footer/scripts) → Markdown
  const rootElem = $.root()[0];
  const allChildren = rootElem.children || [];
  for (const child of allChildren) {
    const md = nodeToMarkdown(child, 0).trim();
    if (md) {
      result += md;
      if (!md.endsWith('\n\n')) {
        result += '\n\n';
      }
    }
  }

  // 5c) Append each “kept” <script> (under MAX_SCRIPT_CHARS) as a ```js``` fence
  if (keptScriptContents.length) {
    keptScriptContents.forEach((scriptText) => {
      const esc = escapeBackticks(scriptText);
      result += `\`\`\`js\n${esc}\n\`\`\`\n\n`;
    });
  }
  
  return result.trim() + '\n';
};