/**
 * src/components/StructuredMarkdown.tsx
 * Self-contained, zero-dependency Markdown parser and renderer using React JSX and Tailwind CSS classes.
 * Formats Markdown tables, headings, bulleted/numbered lists, code blocks with copy action,
 * and inline elements (bold, italic, inline code, and [Source] citation badges).
 */

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { SourceResolver } from '@/services/brightspace/sourceLinks';
import { openSourceLink } from '@/services/chat/chatHandoff';
import { isUncited, parseCitation, resolveCitation } from '@/services/llm/citations';
import type { SourceRegistry } from '@/services/context/sourceRegistry';

/** Older free-text citations: lets a tool link a "[Title Slide 3]" to the document in Brightspace. */
const SourceLinksContext = React.createContext<SourceResolver | undefined>(undefined);
export const SourceLinksProvider = SourceLinksContext.Provider;

/** The sources of a model answer (by id). Inside it, statements without a source get a "no source" marker. */
const AnswerSourcesContext = React.createContext<SourceRegistry | undefined>(undefined);
export const AnswerSourcesProvider = AnswerSourcesContext.Provider;

export interface StructuredMarkdownProps {
  content: string;
  className?: string;
}

interface TableBlock {
  type: 'table';
  headers: string[];
  alignments: ('left' | 'center' | 'right')[];
  rows: string[][];
}

interface CodeBlockData {
  type: 'code';
  language: string;
  code: string;
}

interface HeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}

interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: string[];
}

interface BlockquoteBlock {
  type: 'blockquote';
  text: string;
}

interface DividerBlock {
  type: 'hr';
}

interface ParagraphBlock {
  type: 'paragraph';
  text: string;
}

type MarkdownBlock =
  | TableBlock
  | CodeBlockData
  | HeadingBlock
  | ListBlock
  | BlockquoteBlock
  | DividerBlock
  | ParagraphBlock;

// Helper to split row into cells
function parseRowCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((c) => c.trim());
}

// Check if a line is a table separator: | --- | :---: | ---: |
function isTableSeparator(line: string): boolean {
  if (!line || !line.includes('-')) return false;
  const cells = parseRowCells(line);
  if (cells.length < 1) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

// Parse alignment from separator line
function parseTableAlignments(separatorLine: string): ('left' | 'center' | 'right')[] {
  const cells = parseRowCells(separatorLine);
  return cells.map((cell) => {
    const c = cell.trim();
    if (c.startsWith(':') && c.endsWith(':')) return 'center';
    if (c.endsWith(':')) return 'right';
    return 'left';
  });
}

// Inline tokens, in this order: [[ID locator]] citation, older keyword citation, `code`, **bold**, *italic*, [text](url), any other [bracket]
const INLINE_TOKEN_SOURCE =
  /(\[\[[^\[\]\n]{1,200}\]\])|(\[(?:(?:(?:Source|Bron|Slide|Page|Pagina|Chapter|Hoofdstuk|Lecture|College|Assignment|Opdracht)(?::|\s)\s*[^\]]+)|(?:Source|Bron)|(?:(?:Slide|Page|Pagina)\s*\d+)|Syllabus)\])|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[([^\]]+)\]\(([^)]+)\))|(\[[^\]\n]{2,120}\](?!\())/;

function hasInlineTokens(text: string): boolean {
  return new RegExp(INLINE_TOKEN_SOURCE.source, 'i').test(text);
}

/** What the inline renderer needs to know about the sources of the message it renders. */
interface InlineCtx {
  /** Older free-text citations: a link for a "[Title Slide 3]" that matches a document. */
  resolve?: SourceResolver;
  /** The citeable sources of this answer, by id. */
  registry?: SourceRegistry;
  /** Model answers: statements without any source get a quiet marker. */
  markUncited: boolean;
}

// The looks a source can have, apart from body text: a blue underlined link, or a grey box when there is no link.
const LINK_CLASS = 'mx-0.5 text-[11px] font-medium text-blue-600 underline transition-colors hover:text-blue-800';
const NO_LINK_CLASS = 'mx-0.5 cursor-default rounded border border-slate-200 bg-slate-100 px-1 text-[11px] font-medium text-slate-500 no-underline';

function sourceNode(text: string, url: string | undefined, reason: string | undefined, key: string | number): React.ReactNode {
  if (url) {
    return (
      <a
        key={key}
        data-citation=""
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Brightspace (Ctrl+click: new tab)"
        onClick={(e) => openSourceLink(e, url)}
        onAuxClick={(e) => openSourceLink(e, url)}
        className={LINK_CLASS}
      >
        {text}
      </a>
    );
  }
  return (
    <span key={key} data-citation="" title={reason ?? 'Source (no link available)'} className={NO_LINK_CLASS}>
      {text}
    </span>
  );
}

/** The marker after a statement that carries no source. */
export const UncitedMark: React.FC = () => (
  <span
    data-uncited=""
    title="This is not linked to any course material"
    className="ml-1 whitespace-nowrap rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700 align-middle"
  >
    no source
  </span>
);

/** Adds the "no source" marker to a rendered statement when it needs a source and has none. */
function withUncited(text: string, node: React.ReactNode, ctx: InlineCtx, minWords = 4): React.ReactNode {
  if (!ctx.markUncited || !isUncited(text, minWords)) return node;
  return (
    <>
      {node}
      <UncitedMark />
    </>
  );
}

// Render inline text with citations, bold, italic, code, and links
function renderInlineText(text: string, ctx: InlineCtx): React.ReactNode {
  if (!text) return null;
  if (!hasInlineTokens(text)) return text;

  const elements: React.ReactNode[] = [];
  let keyIdx = 0;
  const tokenMatcher = new RegExp(INLINE_TOKEN_SOURCE.source, 'gi');

  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = tokenMatcher.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const matchedStr = match[0];
    if (match[1]) {
      // [[D123 Slide 14]]: label, link and reason come from the registry, not from the model's text
      const parts = parseCitation(matchedStr.slice(2, -2));
      if (!parts) {
        elements.push(matchedStr);
      } else {
        parts.forEach((part, i) => {
          const r = resolveCitation(part, ctx.registry);
          elements.push(sourceNode(r.text, r.url, r.reason, `cite-${keyIdx++}-${i}`));
        });
      }
    } else if (match[2] || match[9]) {
      // Older free-text citation: linked when it clearly names one document, else a grey box. A bracket that is
      // not a known citation stays plain text.
      const parts = matchedStr.slice(1, -1).split(/\s*;\s*/); // "[A p. 2; B Slide 3]": every source is its own link
      const links = parts.map((part) => ({ text: parts.length > 1 ? part : matchedStr, url: ctx.resolve?.(`[${part}]`) }));
      if (!match[2] && !links.some((l) => l.url)) {
        elements.push(matchedStr);
      } else if (parts.length === 1) {
        elements.push(sourceNode(matchedStr, links[0].url, undefined, `cite-${keyIdx++}`));
      } else {
        elements.push(
          <span key={`cite-${keyIdx++}`}>
            {'['}
            {links.map((l, i) => (
              <React.Fragment key={i}>
                {i > 0 && '; '}
                {sourceNode(l.text, l.url, undefined, i)}
              </React.Fragment>
            ))}
            {']'}
          </span>
        );
      }
    } else if (match[3]) {
      // Inline code
      const codeContent = matchedStr.slice(1, -1);
      elements.push(
        <code
          key={`code-${keyIdx++}`}
          className="px-1 py-0.5 rounded text-[11px] font-mono bg-slate-100 text-slate-800 border border-slate-200"
        >
          {codeContent}
        </code>
      );
    } else if (match[4]) {
      // Bold
      const boldText = matchedStr.slice(2, -2);
      elements.push(
        <strong key={`bold-${keyIdx++}`} className="font-semibold text-slate-900">
          {renderInlineText(boldText, ctx)}
        </strong>
      );
    } else if (match[5]) {
      // Italic
      const italicText = matchedStr.slice(1, -1);
      elements.push(
        <em key={`em-${keyIdx++}`} className="italic text-slate-800">
          {renderInlineText(italicText, ctx)}
        </em>
      );
    } else if (match[6]) {
      // Link
      const linkText = match[7];
      const linkUrl = match[8];
      // Only web links are clickable: an answer can repeat text from course materials, and javascript: would run on the Brightspace page
      if (!/^https?:\/\//i.test(linkUrl.trim())) {
        elements.push(matchedStr);
        lastIndex = tokenMatcher.lastIndex;
        continue;
      }
      elements.push(
        <a
          key={`link-${keyIdx++}`}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline hover:text-blue-800 transition-colors"
        >
          {linkText}
        </a>
      );
    }

    lastIndex = tokenMatcher.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  const merged: React.ReactNode[] = [];
  for (const el of elements) {
    const last = merged[merged.length - 1];
    if (typeof el === 'string' && typeof last === 'string') merged[merged.length - 1] = last + el;
    else merged.push(el);
  }
  return merged.length === 1 ? merged[0] : merged;
}

// Code Block with Copy Button Component
const CodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard errors
    }
  };

  return (
    <div className="my-2 rounded-md bg-slate-900 text-slate-100 font-mono text-[11px] overflow-hidden border border-slate-800 shadow-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950/80 border-b border-slate-800 text-[10px] text-slate-400">
        <span className="font-semibold uppercase tracking-wider">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 hover:text-white transition-colors"
          title="Kopieer code"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Gekopieerd!</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Kopieer</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[11px] font-mono leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
};

// Line-by-line block parser
function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  if (!content || typeof content !== 'string') return [];

  const lines = content.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Skip blank lines
    if (trimmed === '') {
      i++;
      continue;
    }

    // 2. Fenced code block
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++;
      }
      blocks.push({
        type: 'code',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // 3. Table
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseRowCells(line);
      const alignments = parseTableAlignments(lines[i + 1]);
      const rows: string[][] = [];
      i += 2;

      while (i < lines.length && lines[i].includes('|') && !lines[i].trim().startsWith('```')) {
        if (!isTableSeparator(lines[i])) {
          rows.push(parseRowCells(lines[i]));
        }
        i++;
      }

      blocks.push({
        type: 'table',
        headers,
        alignments,
        rows,
      });
      continue;
    }

    // 4. Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        type: 'heading',
        level,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // 5. Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 6. Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        text: quoteLines.join('\n'),
      });
      continue;
    }

    // 7. Bullet list
    if (/^\s*[-*+]\s+(.*)$/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const bulletMatch = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (bulletMatch) {
          items.push(bulletMatch[1].trim());
          i++;
        } else if (
          lines[i].trim() !== '' &&
          !lines[i].trim().startsWith('```') &&
          !lines[i].match(/^#{1,6}\s+/) &&
          !lines[i].includes('|') &&
          !lines[i].match(/^\s*\d+\.\s+/)
        ) {
          if (items.length > 0) {
            items[items.length - 1] += ' ' + lines[i].trim();
          }
          i++;
        } else {
          break;
        }
      }
      blocks.push({
        type: 'list',
        ordered: false,
        items,
      });
      continue;
    }

    // 8. Numbered list
    if (/^\s*\d+\.\s+(.*)$/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const numMatch = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (numMatch) {
          items.push(numMatch[1].trim());
          i++;
        } else if (
          lines[i].trim() !== '' &&
          !lines[i].trim().startsWith('```') &&
          !lines[i].match(/^#{1,6}\s+/) &&
          !lines[i].includes('|') &&
          !lines[i].match(/^\s*[-*+]\s+/)
        ) {
          if (items.length > 0) {
            items[items.length - 1] += ' ' + lines[i].trim();
          }
          i++;
        } else {
          break;
        }
      }
      blocks.push({
        type: 'list',
        ordered: true,
        items,
      });
      continue;
    }

    // 9. Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].match(/^#{1,6}\s+/) &&
      !lines[i].match(/^\s*[-*+]\s+/) &&
      !lines[i].match(/^\s*\d+\.\s+/) &&
      !lines[i].trim().startsWith('>') &&
      !/^(\*{3,}|-{3,}|_{3,})$/.test(lines[i].trim()) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        text: paraLines.join('\n'),
      });
    }
  }

  return blocks;
}

export const StructuredMarkdown: React.FC<StructuredMarkdownProps> = ({
  content,
  className = '',
}) => {
  const resolve = React.useContext(SourceLinksContext);
  const registry = React.useContext(AnswerSourcesContext);
  const ctx: InlineCtx = { resolve, registry, markUncited: registry !== undefined };
  if (!content || !content.trim()) {
    return null;
  }

  const blocks = parseMarkdownBlocks(content);

  const getAlignClass = (align?: 'left' | 'center' | 'right') => {
    if (align === 'center') return 'text-center';
    if (align === 'right') return 'text-right';
    return 'text-left';
  };

  return (
    <div className={`structured-markdown space-y-1 font-sans ${className}`}>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'table':
            return (
              <div
                key={`tbl-${idx}`}
                className="overflow-x-auto my-2 rounded-md border border-slate-200 shadow-xs"
              >
                <table className="min-w-full text-xs text-left divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      {block.headers.map((h, colIdx) => (
                        <th
                          key={`th-${colIdx}`}
                          className={`px-2.5 py-1.5 font-semibold text-slate-700 bg-slate-50 border-r border-slate-200 last:border-r-0 ${getAlignClass(
                            block.alignments[colIdx]
                          )}`}
                        >
                          {renderInlineText(h, ctx)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {block.rows.map((row, rowIdx) => (
                      <tr key={`tr-${rowIdx}`} className="hover:bg-slate-50/60 transition-colors">
                        {block.headers.map((_, colIdx) => {
                          const cell = row[colIdx] ?? '';
                          return (
                            <td
                              key={`td-${colIdx}`}
                              className={`px-2.5 py-1.5 border-r border-slate-200 last:border-r-0 text-slate-800 ${getAlignClass(
                                block.alignments[colIdx]
                              )}`}
                            >
                              {renderInlineText(cell, ctx)}
                              {colIdx === block.headers.length - 1 && ctx.markUncited && isUncited(row.join(' '), 2) ? <UncitedMark /> : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'code':
            return <CodeBlock key={`code-${idx}`} code={block.code} language={block.language} />;

          case 'heading': {
            const inline = renderInlineText(block.text, ctx);
            if (block.level === 1) {
              return (
                <h1
                  key={`h1-${idx}`}
                  className="text-sm font-bold text-slate-900 mt-2.5 mb-1 pb-1 border-b border-slate-200"
                >
                  {inline}
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2
                  key={`h2-${idx}`}
                  className="text-xs font-bold text-slate-900 mt-2 mb-1 text-[13px]"
                >
                  {inline}
                </h2>
              );
            }
            if (block.level === 3) {
              return (
                <h3 key={`h3-${idx}`} className="text-xs font-semibold text-slate-800 mt-1.5 mb-0.5">
                  {inline}
                </h3>
              );
            }
            return (
              <h4 key={`h4-${idx}`} className="text-xs font-medium text-slate-700 mt-1 mb-0.5">
                {inline}
              </h4>
            );
          }

          case 'list': {
            if (block.ordered) {
              return (
                <ol
                  key={`ol-${idx}`}
                  className="list-decimal pl-4 my-1 space-y-0.5 text-slate-800"
                >
                  {block.items.map((item, itemIdx) => (
                    <li key={`li-${itemIdx}`} className="leading-relaxed">
                      {withUncited(item, renderInlineText(item, ctx), ctx)}
                    </li>
                  ))}
                </ol>
              );
            }
            return (
              <ul key={`ul-${idx}`} className="list-disc pl-4 my-1 space-y-0.5 text-slate-800">
                {block.items.map((item, itemIdx) => (
                  <li key={`li-${itemIdx}`} className="leading-relaxed">
                    {withUncited(item, renderInlineText(item, ctx), ctx)}
                  </li>
                ))}
              </ul>
            );
          }

          case 'blockquote':
            return (
              <blockquote
                key={`quote-${idx}`}
                className="border-l-2 border-blue-500 pl-3 my-1.5 italic text-slate-700 bg-blue-50/20 py-1 rounded-r text-xs"
              >
                {withUncited(block.text, renderInlineText(block.text, ctx), ctx)}
              </blockquote>
            );

          case 'hr':
            return <hr key={`hr-${idx}`} className="my-2 border-slate-200" />;

          case 'paragraph': {
            // For plain paragraphs without Markdown tokens, render directly in
            // <p className="my-1 leading-relaxed text-slate-800">{text}</p>
            // so getByText in testing-library works.
            if (!hasInlineTokens(block.text)) {
              return (
                <p key={`p-${idx}`} className="my-1 leading-relaxed text-slate-800 whitespace-pre-line">
                  {withUncited(block.text, block.text, ctx)}
                </p>
              );
            }
            return (
              <p key={`p-${idx}`} className="my-1 leading-relaxed text-slate-800 whitespace-pre-line">
                {withUncited(block.text, renderInlineText(block.text, ctx), ctx)}
              </p>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
};
