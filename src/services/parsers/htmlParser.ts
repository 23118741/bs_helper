import { ParsedDocument, ParseOptions } from '@/types/parser';
import { createTurndownService, cleanMarkdown, estimateTokenCount } from './turndownConfig';

/**
 * Tags that must be completely removed along with all their descendants.
 */
const TAGS_TO_REMOVE = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'svg',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'nav',
  'header',
  'footer',
  'aside',
];

/**
 * Selectors for hidden elements and Brightspace navigation chrome.
 */
const SELECTORS_TO_REMOVE = [
  '[hidden]',
  '[aria-hidden="true"]',
  '[style*="display: none"]',
  '[style*="display:none"]',
  '[style*="visibility: hidden"]',
  '[style*="visibility:hidden"]',
  '.d2l-navigation-s',
  '.d2l-navigation-gutters',
  '.d2l-page-header',
  '.d2l-skip-to-content',
  '.d2l-minibar',
  '.d2l-header',
  '.d2l-footer',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
];

/**
 * Sanitizes an HTML string using DOMParser in browser or jsdom.
 */
export function sanitizeHtmlDocument(rawHtml: string): string {
  if (typeof DOMParser === 'undefined') {
    // Regex fallback if DOMParser is unavailable
    return rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // 1. Remove unwanted tags
  for (const tag of TAGS_TO_REMOVE) {
    const elements = doc.querySelectorAll(tag);
    elements.forEach((el) => el.remove());
  }

  // 2. Remove hidden and navigation selectors
  for (const selector of SELECTORS_TO_REMOVE) {
    try {
      const elements = doc.querySelectorAll(selector);
      elements.forEach((el) => el.remove());
    } catch {
      // Ignore unsupported pseudo-selectors
    }
  }

  // 3. Clean up anchor tags with empty or javascript hrefs
  const anchors = doc.querySelectorAll('a');
  anchors.forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('javascript:') || href === '#') {
      a.removeAttribute('href');
    }
  });

  // 4. Return sanitized HTML body content
  return doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;
}

export class HtmlParser {
  public supports(filename: string, mimeType?: string): boolean {
    if (mimeType && mimeType.toLowerCase() === 'text/html') return true;
    const lower = filename.toLowerCase();
    return lower.endsWith('.html') || lower.endsWith('.htm');
  }

  public async parse(
    input: string | ArrayBuffer | Uint8Array,
    topicIdOrOptions?: string | ParseOptions,
    filename = 'page.html',
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

    let htmlString = '';
    if (typeof input === 'string') {
      htmlString = input;
    } else if (input) {
      // Realm-safe: `instanceof ArrayBuffer/Uint8Array` fails for buffers created in another JS realm
      // (content-script vs page, jsdom vs node), which silently produced an empty document.
      const bytes = ArrayBuffer.isView(input)
        ? new Uint8Array((input as ArrayBufferView).buffer, (input as ArrayBufferView).byteOffset, (input as ArrayBufferView).byteLength)
        : new Uint8Array(input as ArrayBuffer);
      htmlString = new TextDecoder('utf-8').decode(bytes);
    }

    if (!htmlString.trim()) {
      return {
        topicId,
        fileId: topicId,
        filename,
        fileName: filename,
        fileType: 'html',
        extractedText: '',
        extractedMarkdown: '',
        metadata: {
          extractedAt: Date.now(),
          tokenEstimate: 0,
          warnings: ['HTML input is empty.'],
        },
      };
    }

    try {
      // 1. DOMParser sanitization
      const sanitizedHtml = sanitizeHtmlDocument(htmlString);

      // 2. Turndown Markdown conversion
      const turndown = createTurndownService();
      const rawMarkdown = turndown.turndown(sanitizedHtml);
      const markdown = cleanMarkdown(rawMarkdown);

      return {
        topicId,
        fileId: topicId,
        filename,
        fileName: filename,
        fileType: 'html',
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
      const errorText = `[Error parsing HTML document: ${err?.message || String(err)}]`;
      return {
        topicId,
        fileId: topicId,
        filename,
        fileName: filename,
        fileType: 'html',
        extractedText: errorText,
        extractedMarkdown: errorText,
        metadata: {
          extractedAt: Date.now(),
          tokenEstimate: 0,
          warnings: [`HTML parsing error: ${err?.message || String(err)}`],
        },
      };
    }
  }
}

export const htmlParser = new HtmlParser();

export async function parseHtml(
  input: string | ArrayBuffer | Uint8Array,
  optionsOrTopicId?: ParseOptions | string,
  filename?: string,
  maybeOptions?: ParseOptions
): Promise<ParsedDocument & { fileId: string; fileName: string; extractedMarkdown: string }> {
  return htmlParser.parse(input, optionsOrTopicId, filename, maybeOptions);
}
