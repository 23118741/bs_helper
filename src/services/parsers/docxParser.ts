import * as mammoth from 'mammoth';
import JSZip from 'jszip';
import { ParsedDocument, ParseOptions } from '@/types/parser';
import { createTurndownService, cleanMarkdown, estimateTokenCount } from './turndownConfig';

/**
 * Fallback parser extracting raw paragraphs, headings, and tables from word/document.xml
 * when Mammoth cannot parse the document.
 */
async function parseDocxXmlFallback(
  buffer: ArrayBuffer | Uint8Array,
  filename: string,
  topicId: string
): Promise<ParsedDocument & { fileId: string; fileName: string; extractedMarkdown: string }> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('Invalid DOCX: missing word/document.xml entry');
  }

  const xmlText = await docFile.async('string');
  const domParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

  const lines: string[] = [];
  let tableCount = 0;
  let paragraphCount = 0;

  if (domParser) {
    const xmlDoc = domParser.parseFromString(xmlText, 'application/xml');
    const parserError = xmlDoc.querySelector('parsererror');
    if (!parserError) {
      // Process body children in document order
      const body =
        xmlDoc.getElementsByTagNameNS('*', 'body')[0] ||
        xmlDoc.getElementsByTagName('w:body')[0] ||
        xmlDoc.documentElement;
      const children = Array.from(body.children);

      for (const child of children) {
        const localTag = child.localName || child.tagName.replace(/^[a-z]+:/i, '');

        // Paragraph
        if (localTag === 'p') {
          paragraphCount++;
          const textRuns = Array.from(child.getElementsByTagNameNS('*', 't'));
          const pText = textRuns.map((t) => t.textContent || '').join('');
          if (!pText.trim()) continue;

          // Detect heading style
          const pStyle =
            child.getElementsByTagNameNS('*', 'pStyle')[0] ||
            child.getElementsByTagName('w:pStyle')[0];
          const styleVal =
            pStyle?.getAttributeNS('*', 'val') ||
            pStyle?.getAttribute('w:val') ||
            pStyle?.getAttribute('val') ||
            '';

          if (/heading\s*1/i.test(styleVal)) {
            lines.push(`# ${pText.trim()}`);
          } else if (/heading\s*2/i.test(styleVal)) {
            lines.push(`## ${pText.trim()}`);
          } else if (/heading\s*3/i.test(styleVal)) {
            lines.push(`### ${pText.trim()}`);
          } else {
            lines.push(pText.trim());
          }
        }

        // Table
        if (localTag === 'tbl') {
          tableCount++;
          const rows = Array.from(child.getElementsByTagNameNS('*', 'tr'));
          const tableData: string[][] = rows.map((tr) => {
            const cells = Array.from(tr.getElementsByTagNameNS('*', 'tc'));
            return cells.map((tc) => {
              const texts = Array.from(tc.getElementsByTagNameNS('*', 't'));
              return texts
                .map((t) => t.textContent || '')
                .join(' ')
                .trim();
            });
          });

          const colCount = Math.max(...tableData.map((r) => r.length), 0);
          if (colCount > 0) {
            const normalized = tableData.map((row) => {
              const padded = [...row];
              while (padded.length < colCount) padded.push('');
              return padded;
            });

            lines.push('\n| ' + normalized[0].join(' | ') + ' |');
            lines.push('| ' + normalized[0].map(() => '---').join(' | ') + ' |');
            for (let i = 1; i < normalized.length; i++) {
              lines.push('| ' + normalized[i].join(' | ') + ' |');
            }
            lines.push('\n');
          }
        }
      }
    }
  }

  // Regex fallback if DOMParser failed or extracted nothing
  if (lines.length === 0) {
    const pMatches = xmlText.match(/<w:p[\s>].*?<\/w:p>/gs) || [];
    for (const p of pMatches) {
      paragraphCount++;
      const textMatches = p.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
      const text = textMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('');
      if (text.trim()) {
        const isH1 = /w:pStyle[^>]*w:val=["']Heading1["']/i.test(p);
        const isH2 = /w:pStyle[^>]*w:val=["']Heading2["']/i.test(p);
        if (isH1) lines.push(`# ${text.trim()}`);
        else if (isH2) lines.push(`## ${text.trim()}`);
        else lines.push(text.trim());
      }
    }
  }

  const rawMarkdown = lines.join('\n\n');
  const markdown = cleanMarkdown(rawMarkdown);

  return {
    topicId,
    fileId: topicId,
    filename,
    fileName: filename,
    fileType: 'docx',
    extractedText: markdown,
    extractedMarkdown: markdown,
    metadata: {
      paragraphCount,
      tableCount,
      wordCount: markdown.split(/\s+/).filter(Boolean).length,
      extractedAt: Date.now(),
      tokenEstimate: estimateTokenCount(markdown),
      warnings: ['Mammoth conversion failed; extracted text via OpenXML fallback.'],
    },
  };
}

export class DocxParser {
  public supports(filename: string, mimeType?: string): boolean {
    if (
      mimeType &&
      (mimeType.toLowerCase() ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType.toLowerCase() === 'application/msword')
    ) {
      return true;
    }
    const lower = filename.toLowerCase();
    return lower.endsWith('.docx') || lower.endsWith('.doc');
  }

  public async parse(
    buffer: ArrayBuffer | Uint8Array,
    topicIdOrOptions?: string | ParseOptions,
    filename = 'document.docx',
    maybeOptions: ParseOptions = {}
  ): Promise<ParsedDocument & { fileId: string; fileName: string; extractedMarkdown: string }> {
    let topicId = '';
    let options: ParseOptions = {};

    if (typeof topicIdOrOptions === 'string') {
      topicId = topicIdOrOptions;
      options = maybeOptions;
    } else if (topicIdOrOptions && typeof topicIdOrOptions === 'object') {
      options = topicIdOrOptions;
      topicId = options.topicId || '';
      if (options.filename) {
        filename = options.filename;
      }
    }

    if (!topicId) topicId = filename;

    const warnings: string[] = [];

    // 1. Guard against empty buffers
    const byteLength = buffer instanceof Uint8Array ? buffer.byteLength : buffer?.byteLength || 0;
    if (!buffer || byteLength === 0) {
      return {
        topicId,
        fileId: topicId,
        filename,
        fileName: filename,
        fileType: 'docx',
        extractedText: '',
        extractedMarkdown: '',
        metadata: {
          extractedAt: Date.now(),
          tokenEstimate: 0,
          warnings: ['File buffer is empty.'],
        },
      };
    }

    let arrayBuffer: ArrayBuffer;
    if (buffer instanceof Uint8Array) {
      const copy = new Uint8Array(buffer.byteLength);
      copy.set(buffer);
      arrayBuffer = copy.buffer as ArrayBuffer;
    } else {
      arrayBuffer = buffer;
    }

    // 2. Dual Buffer compatibility (arrayBuffer for browser, buffer for Node/Vitest)
    const mammothOptions: any = {
      arrayBuffer,
    };
    if (typeof Buffer !== 'undefined') {
      mammothOptions.buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(arrayBuffer);
    }

    try {
      // 3. Primary execution: Mammoth convertToHtml
      const result = await mammoth.convertToHtml(mammothOptions);

      if (result.messages && result.messages.length > 0) {
        for (const msg of result.messages) {
          if (msg.type === 'warning') {
            warnings.push(`Mammoth: ${msg.message}`);
          }
        }
      }

      const html = result.value || '';
      if (!html.trim()) {
        // If Mammoth produced empty output, attempt XML fallback
        return await parseDocxXmlFallback(arrayBuffer, filename, topicId);
      }

      // 4. Convert Mammoth HTML to clean Markdown via Turndown
      const turndown = createTurndownService();
      const rawMarkdown = turndown.turndown(html);
      const markdown = cleanMarkdown(rawMarkdown);

      return {
        topicId,
        fileId: topicId,
        filename,
        fileName: filename,
        fileType: 'docx',
        extractedText: markdown,
        extractedMarkdown: markdown,
        metadata: {
          wordCount: markdown.split(/\s+/).filter(Boolean).length,
          extractedAt: Date.now(),
          tokenEstimate: estimateTokenCount(markdown),
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    } catch (err: any) {
      // 5. Catch Mammoth exceptions and invoke XML fallback
      try {
        const fallbackResult = await parseDocxXmlFallback(arrayBuffer, filename, topicId);
        const fbWarnings = fallbackResult.metadata.warnings || [];
        fbWarnings.unshift(`Mammoth parser error: ${err?.message || String(err)}`);
        fallbackResult.metadata.warnings = fbWarnings;
        return fallbackResult;
      } catch (fallbackErr: any) {
        const errorText = `[Error parsing Word document: ${fallbackErr?.message || String(fallbackErr)}]`;
        return {
          topicId,
          fileId: topicId,
          filename,
          fileName: filename,
          fileType: 'docx',
          extractedText: errorText,
          extractedMarkdown: errorText,
          metadata: {
            extractedAt: Date.now(),
            tokenEstimate: 0,
            warnings: [
              `Mammoth error: ${err?.message || String(err)}`,
              `Fallback error: ${fallbackErr?.message || String(fallbackErr)}`,
            ],
          },
        };
      }
    }
  }
}

export const docxParser = new DocxParser();

export async function parseDocx(
  buffer: ArrayBuffer | Uint8Array,
  optionsOrTopicId?: ParseOptions | string,
  filename?: string,
  maybeOptions?: ParseOptions
): Promise<ParsedDocument & { fileId: string; fileName: string; extractedMarkdown: string }> {
  return docxParser.parse(buffer, optionsOrTopicId, filename, maybeOptions);
}
