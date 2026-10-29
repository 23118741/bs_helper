import {
  DocumentParseError,
  DocumentParserOptions,
  ParsedDocument,
  SupportedFileType,
} from '@/types/parser';
import { parsePdf } from './pdfParser';
import { parsePptx } from './pptxParser';
import { parseDocx } from './docxParser';
import { parseHtml } from './htmlParser';
import { cleanMarkdown, estimateTokenCount } from './turndownConfig';

/**
 * Identifies the file type from a filename or MIME type.
 */
export function detectFileType(filename: string, mimeType?: string): SupportedFileType {
  const cleanName = (filename || '').split('?')[0].split('#')[0].toLowerCase().trim();
  const cleanMime = (mimeType || '').toLowerCase().trim();

  // PDF
  if (cleanName.endsWith('.pdf') || cleanMime === 'application/pdf' || cleanMime.includes('pdf')) {
    return 'pdf';
  }

  // PPTX
  if (
    cleanName.endsWith('.pptx') ||
    cleanName.endsWith('.ppt') ||
    cleanMime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    cleanMime.includes('presentation')
  ) {
    return 'pptx';
  }

  // DOCX
  if (
    cleanName.endsWith('.docx') ||
    cleanName.endsWith('.doc') ||
    cleanMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    cleanMime.includes('wordprocessingml') ||
    cleanMime.includes('msword')
  ) {
    return 'docx';
  }

  // HTML
  if (
    cleanName.endsWith('.html') ||
    cleanName.endsWith('.htm') ||
    cleanMime === 'text/html' ||
    cleanMime.includes('html')
  ) {
    return 'html';
  }

  // Plain text / Markdown / JSON / CSV
  if (
    cleanName.endsWith('.txt') ||
    cleanName.endsWith('.md') ||
    cleanName.endsWith('.json') ||
    cleanName.endsWith('.csv') ||
    cleanMime.startsWith('text/')
  ) {
    return 'txt';
  }

  return 'unknown';
}

/**
 * Alias for detectFileType
 */
export const detectDocumentType = detectFileType;

/**
 * Checks whether a given filename represents a supported document format.
 */
export function isSupportedFileType(filename: string, mimeType?: string): boolean {
  const type = detectFileType(filename, mimeType);
  return type !== 'unknown';
}

/**
 * Plain text fallback parser for .txt, .md, .csv, .json
 */
export async function parsePlainText(
  input: ArrayBuffer | Uint8Array | string,
  filename = 'document.txt',
  options: DocumentParserOptions = {}
): Promise<ParsedDocument & { fileId: string; fileName: string; extractedMarkdown: string }> {
  const topicId = options.topicId || filename;
  const text =
    typeof input === 'string'
      ? input
      : new TextDecoder('utf-8').decode(input);
  const markdown = cleanMarkdown(text);

  return {
    topicId,
    fileId: topicId,
    filename,
    fileName: filename,
    fileType: 'txt',
    extractedText: markdown,
    extractedMarkdown: markdown,
    metadata: {
      wordCount: markdown.split(/\s+/).filter(Boolean).length,
      extractedAt: Date.now(),
      tokenEstimate: estimateTokenCount(markdown),
    },
  };
}

/**
 * Main router function: Dispatches buffer to the appropriate parser.
 */
export async function parseDocument(
  data: ArrayBuffer | Uint8Array | string,
  filename: string,
  options: DocumentParserOptions = {}
): Promise<ParsedDocument & { fileId: string; fileName: string; extractedMarkdown: string }> {
  const fileType = detectFileType(filename, options.mimeType);
  const topicId = options.topicId || filename;

  if (fileType === 'unknown') {
    throw new DocumentParseError(
      `Unsupported file type for file: "${filename}". Supported types: .pdf, .pptx, .docx, .html, .txt`,
      'UNSUPPORTED_TYPE',
      filename
    );
  }

  // Validate empty input
  if (typeof data === 'string') {
    if (data.trim().length === 0) {
      throw new DocumentParseError(`File "${filename}" contains no content.`, 'EMPTY_FILE', filename);
    }
  } else if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
    if (data.byteLength === 0) {
      throw new DocumentParseError(`File "${filename}" is empty (0 bytes).`, 'EMPTY_FILE', filename);
    }
  }

  try {
    switch (fileType) {
      case 'pdf': {
        const binData =
          typeof data === 'string'
            ? new TextEncoder().encode(data)
            : data;
        const res = await parsePdf(binData, {
          ...options,
          topicId,
          filename,
        });
        return {
          ...res,
          fileId: res.topicId,
          fileName: res.filename,
          extractedMarkdown: res.extractedText,
        };
      }

      case 'pptx': {
        const binData =
          typeof data === 'string'
            ? new TextEncoder().encode(data)
            : data;
        const res = await parsePptx(binData, {
          ...options,
          topicId,
          filename,
        });
        return {
          ...res,
          fileId: res.topicId,
          fileName: res.filename,
          extractedMarkdown: res.extractedText,
        };
      }

      case 'docx': {
        const binData =
          typeof data === 'string'
            ? new TextEncoder().encode(data)
            : data;
        const res = await parseDocx(binData, {
          ...options,
          topicId,
          filename,
        });
        return {
          ...res,
          fileId: res.topicId,
          fileName: res.filename,
          extractedMarkdown: res.extractedText,
        };
      }

      case 'html': {
        const res = await parseHtml(data, {
          ...options,
          topicId,
          filename,
        });
        return {
          ...res,
          fileId: res.topicId,
          fileName: res.filename,
          extractedMarkdown: res.extractedText,
        };
      }

      case 'txt': {
        return await parsePlainText(data, filename, options);
      }
    }
  } catch (err: any) {
    if (err instanceof DocumentParseError) {
      throw err;
    }
    throw new DocumentParseError(
      `Failed to parse document "${filename}": ${err?.message || String(err)}`,
      'PARSE_FAILED',
      filename
    );
  }
}

/**
 * Adapter converting any parser result to standard ParsedDocument model.
 */
export function toParsedDocument(result: any): ParsedDocument {
  return {
    topicId: result.topicId || result.fileId,
    filename: result.filename || result.fileName,
    fileType: result.fileType,
    extractedText: result.extractedText || result.extractedMarkdown || '',
    metadata: {
      pageCount: result.metadata?.pageCount,
      slideCount: result.metadata?.slideCount,
      hasSpeakerNotes: result.metadata?.hasSpeakerNotes,
      paragraphCount: result.metadata?.paragraphCount,
      tableCount: result.metadata?.tableCount,
      wordCount: result.metadata?.wordCount,
      tokenEstimate: result.metadata?.tokenEstimate,
      extractedAt: result.metadata?.extractedAt || Date.now(),
      warnings: result.metadata?.warnings,
    },
  };
}

/**
 * Resilient batch parser executing multiple documents in parallel with Promise.allSettled.
 */
export async function parseDocumentsBatch(
  documents: Array<{
    input: ArrayBuffer | Uint8Array | string;
    filename?: string;
    fileName?: string;
    topicId?: string;
    fileId?: string;
    mimeType?: string;
  }>,
  options: DocumentParserOptions = {}
): Promise<ParsedDocument[]> {
  const settled = await Promise.allSettled(
    documents.map((doc) => {
      const name = doc.filename || doc.fileName || 'unknown';
      const tid = doc.topicId || doc.fileId || name;
      return parseDocument(doc.input, name, {
        ...options,
        topicId: tid,
        mimeType: doc.mimeType,
      });
    })
  );

  return settled.map((res, index) => {
    if (res.status === 'fulfilled') {
      return res.value;
    }
    const doc = documents[index];
    const name = doc.filename || doc.fileName || 'unknown';
    const tid = doc.topicId || doc.fileId || name;
    const fileType = detectFileType(name, doc.mimeType);

    return {
      topicId: tid,
      filename: name,
      fileType,
      extractedText: `[Failed to parse document: ${res.reason?.message || String(res.reason)}]`,
      metadata: {
        extractedAt: Date.now(),
        tokenEstimate: 0,
        warnings: [`Batch item error: ${res.reason?.message || String(res.reason)}`],
      },
    };
  });
}
