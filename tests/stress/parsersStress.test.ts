import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { pdfParser } from '@/services/parsers/pdfParser';
import { pptxParser } from '@/services/parsers/pptxParser';

/**
 * Utility to generate a valid multi-page PDF buffer with exact cross-reference table.
 */
function createMultiPagePdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const byteOffsets: number[] = [];

  // Obj 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');

  // Obj 2: Pages list
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj`);

  // Obj Font (id = 3 + pages.length * 2)
  const fontObjId = 3 + pages.length * 2;

  // Obj Page & Content streams
  pages.forEach((pageText, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontObjId} 0 R >> >> >>\nendobj`
    );

    const stream = pageText
      ? `BT /F1 12 Tf 72 712 Td (${pageText.replace(/[()\\]/g, '\\$&')}) Tj ET`
      : '';
    objects.push(
      `${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`
    );
  });

  // Font object
  objects.push(`${fontObjId} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`);

  // Build PDF buffer and calculate exact offsets
  const header = '%PDF-1.4\n';
  let currentOffset = header.length;

  for (const obj of objects) {
    byteOffsets.push(currentOffset);
    currentOffset += obj.length + 1; // object + newline
  }

  const startXref = currentOffset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of byteOffsets) {
    xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;
  const fullPdf = header + objects.join('\n') + '\n' + xref + trailer;

  return new TextEncoder().encode(fullPdf);
}

/**
 * Utility to generate a PDF with multi-line text positioned by coordinate transforms.
 */
function createCoordinatePdf(lines: Array<{ text: string; x: number; y: number }>): Uint8Array {
  const streamOps = lines
    .map((l) => `1 0 0 1 ${l.x} ${l.y} Tm (${l.text}) Tj`)
    .join('\n');
  const stream = `BT /F1 12 Tf\n${streamOps}\nET`;

  const pdfStr =
    '%PDF-1.4\n' +
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n' +
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream\nendobj\n` +
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n' +
    'xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000227 00000 n \n' +
    'trailer << /Size 6 /Root 1 0 R >>\n' +
    'startxref\n382\n%%EOF';
  return new TextEncoder().encode(pdfStr);
}

describe('M2 Adversarial Stress Testing Suite', () => {
  describe('PDF Parser Stress & Boundary Cases', () => {
    it('correctly extracts multi-page PDF streams with distinct [Page N] headers', async () => {
      const pdf = createMultiPagePdf([
        'Module 1: Introduction to Distributed Systems',
        'Module 2: Consensus and Paxos',
        'Module 3: Byzantine Fault Tolerance',
      ]);

      const result = await pdfParser.parse(pdf, 'multi_page_pdf', 'distributed.pdf');

      expect(result.fileType).toBe('pdf');
      expect(result.metadata.pageCount).toBe(3);
      expect(result.extractedText).toContain('[Page 1]');
      expect(result.extractedText).toContain('Module 1: Introduction to Distributed Systems');
      expect(result.extractedText).toContain('[Page 2]');
      expect(result.extractedText).toContain('Module 2: Consensus and Paxos');
      expect(result.extractedText).toContain('[Page 3]');
      expect(result.extractedText).toContain('Module 3: Byzantine Fault Tolerance');
      expect(result.metadata.warnings).toBeUndefined();
    });

    it('honors maxPages option to truncate extraction on massive multi-page documents', async () => {
      const pdf = createMultiPagePdf([
        'Page One Content',
        'Page Two Content',
        'Page Three Content',
        'Page Four Content',
        'Page Five Content',
      ]);

      const result = await pdfParser.parse(
        pdf,
        { topicId: 'truncate_pdf', filename: 'long.pdf', maxPages: 2 }
      );

      expect(result.metadata.pageCount).toBe(2);
      expect(result.extractedText).toContain('[Page 1]');
      expect(result.extractedText).toContain('Page One Content');
      expect(result.extractedText).toContain('[Page 2]');
      expect(result.extractedText).toContain('Page Two Content');
      expect(result.extractedText).not.toContain('[Page 3]');
      expect(result.extractedText).not.toContain('Page Three Content');
      expect(result.metadata.warnings).toBeDefined();
      expect(result.metadata.warnings![0]).toContain('Extracted first 2 of 5 total pages.');
    });

    it('emits placeholder warning for empty text streams or image-only scanned pages', async () => {
      const pdf = createMultiPagePdf([
        'Text on Page 1',
        '', // Empty page stream
      ]);

      const result = await pdfParser.parse(pdf, 'empty_page_pdf', 'scanned.pdf');

      expect(result.metadata.pageCount).toBe(2);
      expect(result.extractedText).toContain('[Page 1]');
      expect(result.extractedText).toContain('Text on Page 1');
      expect(result.extractedText).toContain('[Page 2]');
      expect(result.extractedText).toContain(
        '[Scanned image or empty page - no selectable text detected]'
      );
    });

    it('survives corrupted headers, zero bytes, and random garbage without unhandled crash', async () => {
      const corruptHeaders = [
        new Uint8Array([0, 0, 0, 0, 0]),
        new TextEncoder().encode('NOT_A_PDF_HEADER'),
        new TextEncoder().encode('%PDF-1.4 but completely truncated and broken'),
        new Uint8Array(500).fill(0xff),
      ];

      for (const corrupt of corruptHeaders) {
        const result = await pdfParser.parse(corrupt, 'corrupt_topic', 'broken.pdf');
        expect(result.fileType).toBe('pdf');
        expect(result.metadata.warnings).toBeDefined();
        expect(result.extractedText).toContain('[Page 1: Error extracting PDF text');
      }
    });

    it('handles buffer slices with byteOffset > 0 safely', async () => {
      const originalPdf = createMultiPagePdf(['Subarray offset test']);
      const paddedBuffer = new Uint8Array(originalPdf.byteLength + 64);
      // Place at offset 32
      paddedBuffer.set(originalPdf, 32);
      const slicedView = new Uint8Array(paddedBuffer.buffer, 32, originalPdf.byteLength);

      const result = await pdfParser.parse(slicedView, 'offset_topic', 'offset.pdf');
      expect(result.extractedText).toContain('[Page 1]');
      expect(result.extractedText).toContain('Subarray offset test');
    });

    it('reconstructs lines based on coordinate tracking', async () => {
      // Lines with large Y jump (> 4) should break into separate lines;
      // same Y line segments should be joined with space.
      const pdf = createCoordinatePdf([
        { text: 'Line 1 Segment A', x: 72, y: 700 },
        { text: 'Segment B', x: 200, y: 700 }, // same line
        { text: 'Line 2 Content', x: 72, y: 650 }, // delta Y = 50 -> newline
      ]);

      const result = await pdfParser.parse(pdf, 'coord_topic', 'coords.pdf');
      expect(result.extractedText).toContain('Line 1 Segment A Segment B');
      expect(result.extractedText).toContain('Line 2 Content');
    });

    it('extracts Unicode and encoded font characters from PDF stream', async () => {
      const pdf = createMultiPagePdf(['Calculus: Introduction to Machine Learning & Optimisation']);
      const result = await pdfParser.parse(pdf, 'unicode_topic', 'math.pdf');
      expect(result.extractedText).toContain('[Page 1]');
      expect(result.extractedText).toContain('Calculus: Introduction to Machine Learning & Optimisation');
    });
  });

  describe('PPTX Parser Stress & OpenXML Boundary Cases', () => {
    it('handles slides in non-consecutive / out-of-order sequence per presentation.xml', async () => {
      const zip = new JSZip();

      // Presentation specifies slide 2 first, then slide 1!
      zip.file(
        'ppt/presentation.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="257" r:id="rId2"/>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`
      );

      zip.file(
        'ppt/_rels/presentation.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`
      );

      // Slide 1 has "Alphabetical Slide One"
      zip.file(
        'ppt/slides/slide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>Content of Slide 1 (Second in Presentation)</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`
      );

      // Slide 2 has "Alphabetical Slide Two"
      zip.file(
        'ppt/slides/slide2.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>Content of Slide 2 (First in Presentation)</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:sld>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'reordered_topic', 'reordered.pptx');

      expect(result.fileType).toBe('pptx');
      expect(result.metadata.slideCount).toBe(2);

      // [Slide 1] MUST be Slide 2
      const slide1Pos = result.extractedText.indexOf('[Slide 1]');
      const slide2Pos = result.extractedText.indexOf('[Slide 2]');
      const contentSlide2Pos = result.extractedText.indexOf('Content of Slide 2 (First in Presentation)');
      const contentSlide1Pos = result.extractedText.indexOf('Content of Slide 1 (Second in Presentation)');

      expect(slide1Pos).toBeLessThan(contentSlide2Pos);
      expect(contentSlide2Pos).toBeLessThan(slide2Pos);
      expect(slide2Pos).toBeLessThan(contentSlide1Pos);
    });

    it('correctly handles presentations with missing speaker notes on some or all slides', async () => {
      const zip = new JSZip();

      zip.file(
        'ppt/presentation.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
</p:presentation>`
      );

      zip.file(
        'ppt/_rels/presentation.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`
      );

      // Slide 1 has rels with speaker notes
      zip.file(
        'ppt/slides/slide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Slide 1 With Notes</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`
      );
      zip.file(
        'ppt/slides/_rels/slide1.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdN1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`
      );
      zip.file(
        'ppt/notesSlides/notesSlide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Confidential instructor notes for Slide 1</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:notes>`
      );

      // Slide 2 has NO rels file and NO speaker notes
      zip.file(
        'ppt/slides/slide2.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Slide 2 Without Any Notes</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'notes_topic', 'notes.pptx');

      expect(result.metadata.hasSpeakerNotes).toBe(true);

      const [slide1Block, slide2Block] = result.extractedText.split('\n\n[Slide 2]');
      expect(slide1Block).toContain('> **Speaker Notes:**');
      expect(slide1Block).toContain('Confidential instructor notes for Slide 1');

      expect(slide2Block).toContain('Slide 2 Without Any Notes');
      expect(slide2Block).not.toContain('> **Speaker Notes:**');
    });

    it('filters out notes chrome placeholders (sldNum, dt, hdr, ftr, sldImg)', async () => {
      const zip = new JSZip();

      zip.file(
        'ppt/presentation.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
      );
      zip.file(
        'ppt/_rels/presentation.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
      );
      zip.file(
        'ppt/slides/slide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Slide With Chrome Notes</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`
      );
      zip.file(
        'ppt/slides/_rels/slide1.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdN1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`
      );
      zip.file(
        'ppt/notesSlides/notesSlide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>Page 42</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="dt"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>October 2026</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="hdr"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>Brightspace University Header</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>All Rights Reserved Footer</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>Slide Thumbnail Preview Text</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>This is genuine speaker note content.</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld>
</p:notes>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'chrome_topic', 'chrome.pptx');

      expect(result.extractedText).toContain('> **Speaker Notes:**');
      expect(result.extractedText).toContain('> This is genuine speaker note content.');
      expect(result.extractedText).not.toContain('Page 42');
      expect(result.extractedText).not.toContain('October 2026');
      expect(result.extractedText).not.toContain('Brightspace University Header');
      expect(result.extractedText).not.toContain('All Rights Reserved Footer');
      expect(result.extractedText).not.toContain('Slide Thumbnail Preview Text');
    });

    it('extracts complex DrawingML tables with pipe escaping and empty cell padding', async () => {
      const zip = new JSZip();

      zip.file(
        'ppt/presentation.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
      );
      zip.file(
        'ppt/_rels/presentation.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
      );
      zip.file(
        'ppt/slides/slide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>Table Slide</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:graphicFrame>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
          <a:tbl>
            <a:tr>
              <a:tc><a:txBody><a:p><a:r><a:t>Header A | With Pipe</a:t></a:r></a:p></a:txBody></a:tc>
              <a:tc><a:txBody><a:p><a:r><a:t>Header B</a:t></a:r></a:p></a:txBody></a:tc>
              <a:tc><a:txBody><a:p><a:r><a:t>Header C</a:t></a:r></a:p></a:txBody></a:tc>
            </a:tr>
            <a:tr>
              <a:tc><a:txBody><a:p><a:r><a:t>Value 1</a:t></a:r></a:p></a:txBody></a:tc>
              <a:tc><a:txBody><a:p></a:p></a:txBody></a:tc>
              <a:tc><a:txBody><a:p><a:r><a:t>Value 3</a:t></a:r></a:p></a:txBody></a:tc>
            </a:tr>
          </a:tbl>
        </a:graphicData>
      </a:graphic>
    </p:graphicFrame>
  </p:spTree></p:cSld>
</p:sld>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'table_topic', 'table.pptx');

      expect(result.extractedText).toContain('| Header A \\| With Pipe | Header B | Header C |');
      expect(result.extractedText).toContain('| --- | --- | --- |');
      expect(result.extractedText).toContain('| Value 1 |   | Value 3 |');
    });

    it('extracts shapes inside nested XML groups (<p:grpSp>)', async () => {
      const zip = new JSZip();

      zip.file(
        'ppt/presentation.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
      );
      zip.file(
        'ppt/_rels/presentation.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
      );
      zip.file(
        'ppt/slides/slide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:txBody><a:p><a:r><a:t>Grouped Shapes Slide</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:grpSp>
      <p:sp>
        <p:txBody><a:p><a:r><a:t>Group Level 1 Text</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:grpSp>
        <p:sp>
          <p:txBody><a:p><a:r><a:t>Group Level 2 Nested Text</a:t></a:r></a:p></p:txBody>
        </p:sp>
      </p:grpSp>
    </p:grpSp>
  </p:spTree></p:cSld>
</p:sld>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'group_topic', 'grouped.pptx');

      expect(result.extractedText).toContain('### Grouped Shapes Slide');
      expect(result.extractedText).toContain('Group Level 1 Text');
      expect(result.extractedText).toContain('Group Level 2 Nested Text');
    });

    it('handles strange/custom XML namespaces and unprefixed elements', async () => {
      const zip = new JSZip();

      // Custom namespace prefix "pres:" and "dml:"
      zip.file(
        'ppt/presentation.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pres:presentation xmlns:pres="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <pres:sldIdLst>
    <pres:sldId id="500" rel:id="rIdCustom1"/>
  </pres:sldIdLst>
</pres:presentation>`
      );
      zip.file(
        'ppt/_rels/presentation.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdCustom1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
      );
      zip.file(
        'ppt/slides/slide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<pres:sld xmlns:pres="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:dml="http://schemas.openxmlformats.org/drawingml/2006/main">
  <pres:cSld><pres:spTree>
    <pres:sp>
      <pres:nvSpPr><pres:nvPr><pres:ph type="title"/></pres:nvPr></pres:nvSpPr>
      <pres:txBody><dml:p><dml:r><dml:t>Custom Namespaced Slide Title</dml:t></dml:r></dml:p></pres:txBody>
    </pres:sp>
    <pres:sp>
      <pres:txBody><dml:p><dml:r><dml:t>Body content with dml prefix</dml:t></dml:r></dml:p></pres:txBody>
    </pres:sp>
  </pres:spTree></pres:cSld>
</pres:sld>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'custom_ns_topic', 'custom_ns.pptx');

      expect(result.extractedText).toContain('### Custom Namespaced Slide Title');
      expect(result.extractedText).toContain('Body content with dml prefix');
    });

    it('falls back to numeric slide discovery if presentation.xml is missing or unparseable', async () => {
      const zip = new JSZip();

      // No presentation.xml or presentation.xml.rels!
      zip.file(
        'ppt/slides/slide2.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Discovered Slide Two</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
      );
      zip.file(
        'ppt/slides/slide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Discovered Slide One</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'fallback_topic', 'fallback.pptx');

      expect(result.metadata.slideCount).toBe(2);
      expect(result.extractedText).toContain('[Slide 1]');
      expect(result.extractedText).toContain('Discovered Slide One');
      expect(result.extractedText).toContain('[Slide 2]');
      expect(result.extractedText).toContain('Discovered Slide Two');
    });

    it('gracefully handles slide XML corruption without failing entire presentation', async () => {
      const zip = new JSZip();

      zip.file(
        'ppt/slides/slide1.xml',
        `MALFORMED_NON_XML_CONTENT <<<<< >>>>>`
      );
      zip.file(
        'ppt/slides/slide2.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 2 is Valid</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'corrupt_slide_topic', 'corrupt_slide.pptx');

      expect(result.extractedText).toContain('[Slide 1]');
      expect(result.extractedText).toContain('[Corrupted slide XML]');
      expect(result.extractedText).toContain('[Slide 2]');
      expect(result.extractedText).toContain('Slide 2 is Valid');
    });

    it('handles relationship targets formatted with absolute-to-package leading slash (/ppt/slides/...)', async () => {
      const zip = new JSZip();

      // Some tools output Target="/ppt/slides/slide1.xml" or "/slides/slide1.xml"
      zip.file(
        'ppt/presentation.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
      );
      zip.file(
        'ppt/_rels/presentation.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="/ppt/slides/slide1.xml"/>
</Relationships>`
      );
      zip.file(
        'ppt/slides/slide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Target with leading slash</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'slash_topic', 'slash.pptx');

      // Check whether it extracted the slide text
      expect(result.extractedText).toContain('Target with leading slash');
    });

    it('handles speaker notes relationship target formatted with leading slash (/ppt/notesSlides/...)', async () => {
      const zip = new JSZip();

      zip.file(
        'ppt/presentation.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`
      );
      zip.file(
        'ppt/_rels/presentation.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
      );
      zip.file(
        'ppt/slides/slide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
      );
      zip.file(
        'ppt/slides/_rels/slide1.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdN1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="/ppt/notesSlides/notesSlide1.xml"/>
</Relationships>`
      );
      zip.file(
        'ppt/notesSlides/notesSlide1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>Speaker note with leading slash target</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:notes>`
      );

      const buffer = await zip.generateAsync({ type: 'uint8array' });
      const result = await pptxParser.parse(buffer, 'notes_slash_topic', 'notes_slash.pptx');

      expect(result.extractedText).toContain('> **Speaker Notes:**');
      expect(result.extractedText).toContain('Speaker note with leading slash target');
    });
  });
});
