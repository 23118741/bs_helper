import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
import { ParsedDocument, ParseOptions } from '@/types/parser';
import { estimateTokenCount } from './turndownConfig';

// Bind worker handler directly to globalThis to eliminate remote worker network fetching
// and run entirely on the main event loop without eval or CSP violations.
if (typeof globalThis !== 'undefined' && !(globalThis as any).pdfjsWorker) {
  (globalThis as any).pdfjsWorker = pdfjsWorker;
}

export class PdfParser {
  public supports(filename: string, mimeType?: string): boolean {
    if (mimeType && mimeType.toLowerCase() === 'application/pdf') return true;
    return filename.toLowerCase().endsWith('.pdf');
  }

  public async parse(
    buffer: ArrayBuffer | Uint8Array,
    topicIdOrOptions?: string | ParseOptions,
    filename = 'document.pdf',
    maybeOptions: ParseOptions = {}
  ): Promise<ParsedDocument> {
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

    const warnings: string[] = [];
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    let doc: pdfjsLib.PDFDocumentProxy | null = null;
    const pageBlocks: string[] = [];
    let pageCount = 0;

    try {
      const loadingTask = pdfjsLib.getDocument({
        data,
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: true,
        verbosity: 0,
        password: options.password || '',
      });

      doc = await loadingTask.promise;
      const totalPages = doc.numPages;
      const maxPages =
        options.maxPages && options.maxPages > 0
          ? Math.min(options.maxPages, totalPages)
          : totalPages;

      if (maxPages < totalPages) {
        warnings.push(`Extracted first ${maxPages} of ${totalPages} total pages.`);
      }

      for (let p = 1; p <= maxPages; p++) {
        const page = await doc.getPage(p);
        const textContent = await page.getTextContent();

        let lastY: number | null = null;
        const lines: string[] = [];
        let currentLine = '';

        for (const item of textContent.items) {
          if (!('str' in item)) continue; // skip TextMarkedContent
          const y = item.transform[5];

          if (lastY !== null && Math.abs(y - lastY) > 4) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = item.str;
          } else {
            if (currentLine && !currentLine.endsWith(' ') && !item.str.startsWith(' ')) {
              currentLine += ' ' + item.str;
            } else {
              currentLine += item.str;
            }
          }
          lastY = y;

          if (item.hasEOL) {
            if (currentLine.trim()) lines.push(currentLine.trim());
            currentLine = '';
            lastY = null;
          }
        }
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
        }

        let pageText = lines.join('\n').trim();
        if (!pageText) {
          pageText = '[Scanned image or empty page - no selectable text detected]';
        }

        pageBlocks.push(`[Page ${p}]\n\n${pageText}`);
        pageCount++;
      }
    } catch (err: any) {
      if (err?.name === 'PasswordException' || err?.message?.toLowerCase().includes('password')) {
        warnings.push('Document is password-protected and cannot be extracted without credentials.');
        pageBlocks.push('[Page 1: Document is encrypted / password-protected]');
        pageCount = 1;
      } else {
        warnings.push(`PDF parsing error: ${err?.message || 'Unknown error'}`);
        pageBlocks.push(`[Page 1: Error extracting PDF text: ${err?.message || 'Corrupted file'}]`);
        pageCount = 1;
      }
    } finally {
      if (doc) {
        try {
          await doc.destroy();
        } catch {
          // ignore cleanup errors
        }
      }
    }

    const extractedText = pageBlocks.join('\n\n');
    const tokenEstimate = estimateTokenCount(extractedText);

    return {
      topicId: topicId || filename,
      filename,
      fileType: 'pdf',
      extractedText,
      metadata: {
        pageCount,
        extractedAt: Date.now(),
        tokenEstimate,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  }
}

export const pdfParser = new PdfParser();

export async function parsePdf(
  buffer: ArrayBuffer | Uint8Array,
  optionsOrTopicId?: ParseOptions | string,
  filename?: string,
  maybeOptions?: ParseOptions
): Promise<ParsedDocument> {
  return pdfParser.parse(buffer, optionsOrTopicId, filename, maybeOptions);
}
