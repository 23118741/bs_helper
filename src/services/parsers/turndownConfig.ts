import TurndownService from 'turndown';

/**
 * Creates and configures a TurndownService instance with:
 * - ATX headings (# H1, ## H2)
 * - Fenced code blocks (```)
 * - Dash bullet list markers (-)
 * - GitHub Flavored Markdown (GFM) table rule
 * - Definition list (<dl>, <dt>, <dd>) rule
 */
export function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  // 1. GitHub Flavored Markdown (GFM) Table Rule
  turndown.addRule('gfmTable', {
    filter: 'table',
    replacement: (_content: string, node: Node) => {
      const tableEl = node as HTMLElement;
      const rows = Array.from(tableEl.querySelectorAll('tr'));
      if (rows.length === 0) return '';

      // Extract text content from each cell, escaping pipe characters and collapsing whitespace
      const tableMatrix: string[][] = rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        return cells.map((cell) =>
          (cell.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\|/g, '\\|')
            .replace(/[\r\n]+/g, ' ')
            .trim()
        );
      });

      // Determine maximum column count
      const colCount = Math.max(...tableMatrix.map((r) => r.length), 0);
      if (colCount === 0) return '';

      // Normalize row lengths so all rows have equal columns
      const normalizedMatrix = tableMatrix.map((row) => {
        const padded = [...row];
        while (padded.length < colCount) {
          padded.push('');
        }
        return padded;
      });

      let md = '\n\n';
      const headerRow = normalizedMatrix[0];
      md += '| ' + headerRow.join(' | ') + ' |\n';
      md += '| ' + headerRow.map(() => '---').join(' | ') + ' |\n';

      for (let i = 1; i < normalizedMatrix.length; i++) {
        md += '| ' + normalizedMatrix[i].join(' | ') + ' |\n';
      }

      return md + '\n';
    },
  });

  // 2. Definition Lists (<dl>, <dt>, <dd>)
  turndown.addRule('definitionList', {
    filter: ['dl', 'dt', 'dd'],
    replacement: (content: string, node: Node) => {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const text = content.trim();
      if (!text) return '';

      if (tag === 'dt') {
        return `\n**${text}**: `;
      }
      if (tag === 'dd') {
        return `${text}\n`;
      }
      return `\n${text}\n`;
    },
  });

  return turndown;
}

/**
 * Normalizes extracted markdown text:
 * - Replaces non-breaking spaces (\u00a0)
 * - Normalizes Windows CRLF linebreaks to LF
 * - Collapses 3+ consecutive newlines to 2
 * - Trims leading and trailing whitespace
 */
export function cleanMarkdown(markdown: string): string {
  if (!markdown) return '';
  return markdown
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fast token estimation heuristic: ~4 characters per token
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
