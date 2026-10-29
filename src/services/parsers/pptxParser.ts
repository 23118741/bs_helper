import JSZip from 'jszip';
import { ParsedDocument, ParseOptions } from '@/types/parser';
import { estimateTokenCount } from './turndownConfig';

export class PptxParser {
  private domParser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

  public supports(filename: string, mimeType?: string): boolean {
    if (
      mimeType &&
      mimeType.toLowerCase() ===
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ) {
      return true;
    }
    return filename.toLowerCase().endsWith('.pptx');
  }

  private parseXml(xmlStr: string): Document | null {
    try {
      if (!this.domParser) {
        this.domParser = new DOMParser();
      }
      const doc = this.domParser.parseFromString(xmlStr, 'application/xml');
      if (
        doc.getElementsByTagName('parsererror').length > 0 ||
        doc.documentElement?.nodeName === 'parsererror'
      ) {
        return null;
      }
      return doc;
    } catch {
      return null;
    }
  }

  private extractTableMarkdown(tblElement: Element): string {
    const rows = Array.from(tblElement.getElementsByTagNameNS('*', 'tr'));
    if (rows.length === 0) return '';

    const tableMatrix: string[][] = [];
    for (const tr of rows) {
      const cells = Array.from(tr.getElementsByTagNameNS('*', 'tc'));
      const rowTexts: string[] = [];
      for (const tc of cells) {
        const textNodes = Array.from(tc.getElementsByTagNameNS('*', 't'));
        const cellText = textNodes
          .map((t) => (t.textContent || '').trim())
          .filter(Boolean)
          .join(' ');
        rowTexts.push(cellText.replace(/\|/g, '\\|') || ' ');
      }
      tableMatrix.push(rowTexts);
    }

    if (tableMatrix.length === 0) return '';
    const colCount = Math.max(...tableMatrix.map((r) => r.length), 0);
    if (colCount === 0) return '';

    const normalized = tableMatrix.map((r) => {
      const padded = [...r];
      while (padded.length < colCount) padded.push(' ');
      return padded;
    });

    const header = `| ${normalized[0].join(' | ')} |`;
    const separator = `| ${new Array(colCount).fill('---').join(' | ')} |`;
    const bodyRows = normalized.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n');

    return [header, separator, bodyRows].filter(Boolean).join('\n');
  }

  public async parse(
    buffer: ArrayBuffer | Uint8Array,
    topicIdOrOptions?: string | ParseOptions,
    filename = 'presentation.pptx',
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
    const includeSpeakerNotes = options.includeSpeakerNotes !== false;
    const includeTables = options.includeTables !== false;

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch (err: any) {
      return {
        topicId: topicId || filename,
        filename,
        fileType: 'pptx',
        extractedText: `[Slide 1: Error reading PPTX archive: ${err?.message || 'Invalid or encrypted ZIP file'}]`,
        metadata: {
          slideCount: 0,
          hasSpeakerNotes: false,
          extractedAt: Date.now(),
          tokenEstimate: 0,
          warnings: ['Invalid or encrypted PPTX archive'],
        },
      };
    }

    // 1. Resolve Presentation Relationships (rId -> slide target)
    const relMap = new Map<string, string>();
    const presRelsFile = zip.file('ppt/_rels/presentation.xml.rels');
    if (presRelsFile) {
      const text = await presRelsFile.async('text');
      const doc = this.parseXml(text);
      if (doc) {
        const rels = doc.getElementsByTagNameNS('*', 'Relationship');
        for (const rel of Array.from(rels)) {
          const id = rel.getAttribute('Id');
          const target = rel.getAttribute('Target');
          if (id && target) relMap.set(id, target);
        }
      }
    }

    // 2. Discover Slide Paths in Strict Presentation Order
    let slidePaths: string[] = [];
    const presFile = zip.file('ppt/presentation.xml');
    if (presFile) {
      const text = await presFile.async('text');
      const doc = this.parseXml(text);
      if (doc) {
        const sldIds = doc.getElementsByTagNameNS('*', 'sldId');
        for (const sld of Array.from(sldIds)) {
          const rId =
            sld.getAttribute('r:id') ||
            sld.getAttributeNS(
              'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
              'id'
            );
          if (rId && relMap.has(rId)) {
            const rawTarget = relMap.get(rId)!;
            const cleanTarget = rawTarget
              .replace(/^(\.\/)+/, '')
              .replace(/^(\.\.\/)+/, '')
              .replace(/^\/?ppt\//, '')
              .replace(/^\//, '');
            slidePaths.push('ppt/' + cleanTarget);
          }
        }
      }
    }

    // Fallback if presentation.xml or rels were missing/empty: numeric discovery
    if (slidePaths.length === 0) {
      const discovered: Array<{ path: string; num: number }> = [];
      zip.forEach((path) => {
        const m = path.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
        if (m) discovered.push({ path, num: parseInt(m[1], 10) });
      });
      discovered.sort((a, b) => a.num - b.num);
      slidePaths = discovered.map((d) => d.path);
    }

    if (slidePaths.length === 0) {
      warnings.push('No slides found in PPTX presentation.');
      return {
        topicId: topicId || filename,
        filename,
        fileType: 'pptx',
        extractedText: '[Slide 1: Empty presentation - zero slides found]',
        metadata: {
          slideCount: 0,
          hasSpeakerNotes: false,
          extractedAt: Date.now(),
          tokenEstimate: 0,
          warnings,
        },
      };
    }

    const totalSlides = slidePaths.length;
    const maxSlides =
      options.maxPages && options.maxPages > 0
        ? Math.min(options.maxPages, totalSlides)
        : totalSlides;

    if (maxSlides < totalSlides) {
      warnings.push(`Extracted first ${maxSlides} of ${totalSlides} total slides.`);
    }

    const slideBlocks: string[] = [];
    let presentationHasNotes = false;

    for (let i = 0; i < maxSlides; i++) {
      const slidePath = slidePaths[i];
      const slideIndex = i + 1;
      const sFile = zip.file(slidePath);
      if (!sFile) continue;

      const sXml = await sFile.async('text');
      const sDoc = this.parseXml(sXml);
      if (!sDoc) {
        slideBlocks.push(`[Slide ${slideIndex}]\n### Slide ${slideIndex}\n[Corrupted slide XML]`);
        continue;
      }

      let title = '';
      const bodyParagraphs: string[] = [];

      // Extract shapes & title
      const shapes = Array.from(sDoc.getElementsByTagNameNS('*', 'sp'));
      for (const sp of shapes) {
        const phs = sp.getElementsByTagNameNS('*', 'ph');
        const phType = phs.length > 0 ? phs[0].getAttribute('type') : null;
        const isTitle = phType === 'title' || phType === 'ctrTitle';

        const paragraphs = Array.from(sp.getElementsByTagNameNS('*', 'p'));
        const shapeLines: string[] = [];
        for (const p of paragraphs) {
          const textNodes = Array.from(p.getElementsByTagNameNS('*', 't'));
          const line = textNodes.map((t) => t.textContent || '').join('').trim();
          if (line) shapeLines.push(line);
        }

        if (isTitle && !title) {
          title = shapeLines.join(' ');
        } else {
          bodyParagraphs.push(...shapeLines);
        }
      }

      // If no title was explicitly marked as title placeholder, check first non-empty text
      if (!title && bodyParagraphs.length > 0) {
        title = bodyParagraphs.shift()!;
      }
      if (!title) {
        title = `Slide ${slideIndex}`;
      }

      // Extract DrawingML Tables
      if (includeTables) {
        const tables = Array.from(sDoc.getElementsByTagNameNS('*', 'tbl'));
        for (const tbl of tables) {
          const tableMd = this.extractTableMarkdown(tbl);
          if (tableMd) bodyParagraphs.push(tableMd);
        }
      }

      // Extract Speaker Notes via Slide Relationships
      let speakerNotes = '';
      if (includeSpeakerNotes) {
        const fileName = slidePath.split('/').pop()!;
        const slideRelsPath = slidePath.replace(fileName, `_rels/${fileName}.rels`);
        const sRelsFile = zip.file(slideRelsPath);
        let notesTarget: string | null = null;

        if (sRelsFile) {
          const sRelsXml = await sRelsFile.async('text');
          const sRelsDoc = this.parseXml(sRelsXml);
          if (sRelsDoc) {
            const rels = Array.from(sRelsDoc.getElementsByTagNameNS('*', 'Relationship'));
            for (const rel of rels) {
              const type = rel.getAttribute('Type') || '';
              if (type.endsWith('/notesSlide')) {
                notesTarget = rel.getAttribute('Target');
                break;
              }
            }
          }
        }

        let resolvedNotesPath: string | null = null;
        if (notesTarget) {
          const cleanTarget = notesTarget
            .replace(/^\/?ppt\//, '')
            .replace(/^(\.\.\/)+/, '')
            .replace(/^(\.\/)+/, '')
            .replace(/^\//, '');
          resolvedNotesPath =
            'ppt/' +
            (cleanTarget.startsWith('notesSlides/')
              ? cleanTarget
              : 'notesSlides/' + cleanTarget);
        } else if (!sRelsFile) {
          // Fallback to numeric discovery only if .rels file was completely missing
          resolvedNotesPath = `ppt/notesSlides/notesSlide${slideIndex}.xml`;
        }

        const nFile = resolvedNotesPath ? zip.file(resolvedNotesPath) : null;
        if (nFile) {
          const nXml = await nFile.async('text');
          const nDoc = this.parseXml(nXml);
          if (nDoc) {
            const noteShapes = Array.from(nDoc.getElementsByTagNameNS('*', 'sp'));
            const noteLines: string[] = [];

            for (const nSp of noteShapes) {
              const phs = nSp.getElementsByTagNameNS('*', 'ph');
              const phType = phs.length > 0 ? phs[0].getAttribute('type') : null;
              // Skip presentation chrome placeholders
              if (phType && ['sldNum', 'dt', 'hdr', 'ftr', 'sldImg'].includes(phType)) {
                continue;
              }

              const paragraphs = Array.from(nSp.getElementsByTagNameNS('*', 'p'));
              for (const p of paragraphs) {
                const textNodes = Array.from(p.getElementsByTagNameNS('*', 't'));
                const pText = textNodes.map((t) => t.textContent || '').join('').trim();
                if (pText) noteLines.push(pText);
              }
            }

            speakerNotes = noteLines.join('\n').trim();
            if (speakerNotes) presentationHasNotes = true;
          }
        }
      }

      // Format slide markdown
      let block = `[Slide ${slideIndex}]\n### ${title}\n${bodyParagraphs.join('\n')}`;
      if (speakerNotes) {
        const quotedNotes = speakerNotes
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n');
        block += `\n\n> **Speaker Notes:**\n${quotedNotes}`;
      }

      slideBlocks.push(block.trim());
    }

    if (slideBlocks.length === 0) {
      warnings.push('Could not extract text from any slides in presentation.');
      return {
        topicId: topicId || filename,
        filename,
        fileType: 'pptx',
        extractedText: '[Slide 1: Empty presentation - could not extract slide contents]',
        metadata: {
          slideCount: 0,
          hasSpeakerNotes: false,
          extractedAt: Date.now(),
          tokenEstimate: 0,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    }

    const extractedText = slideBlocks.join('\n\n');
    const tokenEstimate = estimateTokenCount(extractedText);

    return {
      topicId: topicId || filename,
      filename,
      fileType: 'pptx',
      extractedText,
      metadata: {
        slideCount: maxSlides,
        hasSpeakerNotes: presentationHasNotes,
        extractedAt: Date.now(),
        tokenEstimate,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  }
}

export const pptxParser = new PptxParser();

export async function parsePptx(
  buffer: ArrayBuffer | Uint8Array,
  optionsOrTopicId?: ParseOptions | string,
  filename?: string,
  maybeOptions?: ParseOptions
): Promise<ParsedDocument> {
  return pptxParser.parse(buffer, optionsOrTopicId, filename, maybeOptions);
}
