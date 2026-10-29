import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { pdfParser, parsePdf } from '@/services/parsers/pdfParser';
import { pptxParser, parsePptx } from '@/services/parsers/pptxParser';
import { docxParser, parseDocx } from '@/services/parsers/docxParser';
import { htmlParser, parseHtml } from '@/services/parsers/htmlParser';
import {
  parseDocument,
  detectFileType,
  detectDocumentType,
  isSupportedFileType,
  parseDocumentsBatch,
  toParsedDocument,
} from '@/services/parsers/documentParser';
import { DocumentParseError } from '@/types/parser';

// Helper to generate a minimal valid 1-page PDF
function createSamplePdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 712 Td (${text}) Tj ET`;
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

// Helper to generate a valid PPTX with slide, table, and speaker notes
async function createSamplePptx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
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
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Lecture 1: Introduction</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Welcome to BS Helper.</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:graphicFrame>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tr>
                <a:tc><a:txBody><a:p><a:r><a:t>Topic</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>Week</a:t></a:r></a:p></a:txBody></a:tc>
              </a:tr>
              <a:tr>
                <a:tc><a:txBody><a:p><a:r><a:t>AI Basics</a:t></a:r></a:p></a:txBody></a:tc>
                <a:tc><a:txBody><a:p><a:r><a:t>Week 1</a:t></a:r></a:p></a:txBody></a:tc>
              </a:tr>
            </a:tbl>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
</p:sld>`
  );

  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`
  );

  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>Announce homework 1 due next Friday.</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`
  );

  return zip.generateAsync({ type: 'uint8array' });
}

// Helper to generate minimal valid DOCX ArrayBuffer
async function createSampleDocx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>'
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Syllabus 2026</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Course:</w:t></w:r><w:r><w:t> Artificial Intelligence</w:t></w:r></w:p>' +
      '<w:tbl>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Week</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Topic</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Agents</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl>' +
      '</w:body></w:document>'
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('M2 In-Browser Document Parsers Suite', () => {
  describe('PDF Parser (pdfParser.ts)', () => {
    it('extracts text tagged with [Page 1] from genuine PDF buffer', async () => {
      const pdf = createSamplePdf('Artificial Intelligence Syllabus');
      const result = await pdfParser.parse(pdf, 'topic_pdf_1', 'syllabus.pdf');

      expect(result.fileType).toBe('pdf');
      expect(result.extractedText).toContain('[Page 1]');
      expect(result.extractedText).toContain('Artificial Intelligence Syllabus');
      expect(result.metadata.pageCount).toBe(1);
      expect(result.metadata.tokenEstimate).toBeGreaterThan(0);
    });

    it('works via standalone parsePdf function', async () => {
      const pdf = createSamplePdf('Standalone Function Test');
      const result = await parsePdf(pdf, { topicId: 'topic_pdf_func', filename: 'func.pdf' });

      expect(result.fileType).toBe('pdf');
      expect(result.extractedText).toContain('[Page 1]');
      expect(result.extractedText).toContain('Standalone Function Test');
    });

    it('gracefully handles empty or corrupted PDF buffers without crashing', async () => {
      const corrupted = new Uint8Array([0, 1, 2, 3, 4]);
      const result = await pdfParser.parse(corrupted, 'bad_pdf', 'broken.pdf');

      expect(result.fileType).toBe('pdf');
      expect(result.extractedText).toContain('[Page 1: Error extracting PDF text');
      expect(result.metadata.warnings).toBeDefined();
    });
  });

  describe('PPTX Parser (pptxParser.ts)', () => {
    it('extracts slide tagged with [Slide 1], title, body, tables, and speaker notes', async () => {
      const pptx = await createSamplePptx();
      const result = await pptxParser.parse(pptx, 'topic_pptx_1', 'lecture.pptx');

      expect(result.fileType).toBe('pptx');
      expect(result.extractedText).toContain('[Slide 1]');
      expect(result.extractedText).toContain('### Lecture 1: Introduction');
      expect(result.extractedText).toContain('Welcome to BS Helper.');
      expect(result.extractedText).toContain('| Topic | Week |');
      expect(result.extractedText).toContain('| AI Basics | Week 1 |');
      expect(result.extractedText).toContain('> **Speaker Notes:**');
      expect(result.extractedText).toContain('> Announce homework 1 due next Friday.');
      expect(result.extractedText).not.toContain('> 1'); // ignores slide number placeholder
      expect(result.metadata.slideCount).toBe(1);
      expect(result.metadata.hasSpeakerNotes).toBe(true);
    });

    it('works via standalone parsePptx function', async () => {
      const pptx = await createSamplePptx();
      const result = await parsePptx(pptx, { topicId: 'topic_pptx_func', filename: 'slides.pptx' });

      expect(result.fileType).toBe('pptx');
      expect(result.extractedText).toContain('[Slide 1]');
      expect(result.extractedText).toContain('Lecture 1: Introduction');
    });

    it('gracefully handles corrupted PPTX buffers', async () => {
      const corrupted = new Uint8Array([10, 20, 30]);
      const result = await pptxParser.parse(corrupted, 'bad_pptx', 'corrupted.pptx');

      expect(result.metadata.slideCount).toBe(0);
      expect(result.metadata.warnings).toContain('Invalid or encrypted PPTX archive');
    });
  });

  describe('DOCX Parser (docxParser.ts)', () => {
    it('parses valid docx with headings, bold text, and tables into clean markdown', async () => {
      const docx = await createSampleDocx();
      const result = await docxParser.parse(docx, 'topic_docx_1', 'syllabus.docx');

      expect(result.fileType).toBe('docx');
      expect(result.extractedText).toContain('# Syllabus 2026');
      expect(result.extractedText).toContain('**Course:** Artificial Intelligence');
      expect(result.extractedText).toContain('| Week | Topic |');
      expect(result.extractedText).toContain('| 1 | Agents |');
      expect(result.metadata.tokenEstimate).toBeGreaterThan(0);
    });

    it('works via standalone parseDocx function', async () => {
      const docx = await createSampleDocx();
      const result = await parseDocx(docx, { topicId: 'topic_docx_func', filename: 'doc.docx' });

      expect(result.fileType).toBe('docx');
      expect(result.extractedText).toContain('# Syllabus 2026');
    });

    it('survives corrupted docx buffers via XML fallback or clean error', async () => {
      const corruptBuf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]).buffer;
      const result = await docxParser.parse(corruptBuf, 'corrupt.docx');

      expect(result.fileType).toBe('docx');
      expect(result.metadata.warnings).toBeDefined();
    });

    it('handles empty docx buffers gracefully', async () => {
      const empty = new ArrayBuffer(0);
      const result = await docxParser.parse(empty, 'empty.docx');

      expect(result.fileType).toBe('docx');
      expect(result.extractedText).toBe('');
      expect(result.metadata.warnings).toContain('File buffer is empty.');
    });
  });

  describe('HTML Parser (htmlParser.ts)', () => {
    it('sanitizes HTML stripping scripts, styles, nav, and hidden elements while preserving tables and headings', async () => {
      const rawHtml = `
        <html>
          <head><style>body { color: red; }</style><script>alert(1);</script></head>
          <body>
            <nav class="d2l-navigation-s">Navigation Menu</nav>
            <h1>Course Overview</h1>
            <p>Welcome to <em>Computer Systems</em>.</p>
            <div hidden>Secret Exam Answers</div>
            <div style="display: none;">Hidden Instructor Notes</div>
            <table>
              <thead><tr><th>Module</th><th>Due</th></tr></thead>
              <tbody><tr><td>Lab 1</td><td>Oct 10</td></tr></tbody>
            </table>
            <footer>Brightspace Footer</footer>
          </body>
        </html>
      `;

      const result = await htmlParser.parse(rawHtml, 'overview.html');

      expect(result.fileType).toBe('html');
      expect(result.extractedText).toContain('# Course Overview');
      expect(result.extractedText).toContain('Welcome to *Computer Systems*.');
      expect(result.extractedText).toContain('| Module | Due |');
      expect(result.extractedText).toContain('| Lab 1 | Oct 10 |');
      expect(result.extractedText).not.toContain('Navigation Menu');
      expect(result.extractedText).not.toContain('Secret Exam Answers');
      expect(result.extractedText).not.toContain('Hidden Instructor Notes');
      expect(result.extractedText).not.toContain('Brightspace Footer');
    });

    it('handles empty HTML input', async () => {
      const result = await parseHtml('   ', 'empty.html');
      expect(result.fileType).toBe('html');
      expect(result.extractedText).toBe('');
      expect(result.metadata.warnings).toContain('HTML input is empty.');
    });
  });

  describe('Document Parser Router (documentParser.ts)', () => {
    it('detects file types correctly from filename and mimeType', () => {
      expect(detectFileType('lecture.pdf')).toBe('pdf');
      expect(detectFileType('LECTURE.PDF')).toBe('pdf');
      expect(detectFileType('file', 'application/pdf')).toBe('pdf');
      expect(detectFileType('slides.pptx')).toBe('pptx');
      expect(detectFileType('presentation', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('pptx');
      expect(detectFileType('doc.docx')).toBe('docx');
      expect(detectFileType('document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
      expect(detectFileType('page.html')).toBe('html');
      expect(detectFileType('page.htm')).toBe('html');
      expect(detectFileType('page', 'text/html')).toBe('html');
      expect(detectFileType('notes.txt')).toBe('txt');
      expect(detectFileType('readme.md')).toBe('txt');
      expect(detectFileType('unknown.xyz')).toBe('unknown');
      expect(detectDocumentType('slides.pptx')).toBe('pptx');
      expect(isSupportedFileType('lecture.pdf')).toBe(true);
      expect(isSupportedFileType('unknown.xyz')).toBe(false);
    });

    it('routes PDF buffers to pdfParser', async () => {
      const pdf = createSamplePdf('Routed PDF');
      const result = await parseDocument(pdf, 'test.pdf', { topicId: 'routed_1' });

      expect(result.fileType).toBe('pdf');
      expect(result.extractedText).toContain('[Page 1]');
      expect(result.extractedText).toContain('Routed PDF');
    });

    it('routes PPTX buffers to pptxParser', async () => {
      const pptx = await createSamplePptx();
      const result = await parseDocument(pptx, 'test.pptx', { topicId: 'routed_2' });

      expect(result.fileType).toBe('pptx');
      expect(result.extractedText).toContain('[Slide 1]');
      expect(result.extractedText).toContain('Lecture 1: Introduction');
    });

    it('routes DOCX buffers to docxParser', async () => {
      const docx = await createSampleDocx();
      const result = await parseDocument(docx, 'test.docx', { topicId: 'routed_3' });

      expect(result.fileType).toBe('docx');
      expect(result.extractedText).toContain('# Syllabus 2026');
    });

    it('routes HTML strings to htmlParser', async () => {
      const result = await parseDocument('<h1>Routed HTML</h1>', 'test.html', { topicId: 'routed_4' });

      expect(result.fileType).toBe('html');
      expect(result.extractedText).toContain('# Routed HTML');
    });

    it('routes TXT files to plain text parser', async () => {
      const result = await parseDocument('Plain text lecture notes', 'notes.txt', { topicId: 'routed_5' });

      expect(result.fileType).toBe('txt');
      expect(result.extractedText).toBe('Plain text lecture notes');
    });

    it('throws DocumentParseError on unsupported file extensions', async () => {
      await expect(parseDocument(new Uint8Array([1, 2, 3]), 'program.exe')).rejects.toThrow(
        DocumentParseError
      );
      await expect(parseDocument(new Uint8Array([1, 2, 3]), 'archive.zip')).rejects.toMatchObject({
        code: 'UNSUPPORTED_TYPE',
        filename: 'archive.zip',
      });
    });

    it('throws DocumentParseError on empty input buffers or strings', async () => {
      await expect(parseDocument(new ArrayBuffer(0), 'empty.pdf')).rejects.toMatchObject({
        code: 'EMPTY_FILE',
        filename: 'empty.pdf',
      });
      await expect(parseDocument('   ', 'empty.html')).rejects.toMatchObject({
        code: 'EMPTY_FILE',
        filename: 'empty.html',
      });
    });

    it('converts results via toParsedDocument adapter', async () => {
      const pdf = createSamplePdf('Adapter Test');
      const raw = await parseDocument(pdf, 'test.pdf', { topicId: 'ad_1' });
      const adapted = toParsedDocument(raw);

      expect(adapted.topicId).toBe('ad_1');
      expect(adapted.filename).toBe('test.pdf');
      expect(adapted.extractedText).toContain('[Page 1]');
    });

    it('processes batch documents concurrently via parseDocumentsBatch', async () => {
      const pdf = createSamplePdf('Batch PDF');
      const pptx = await createSamplePptx();

      const batch = await parseDocumentsBatch([
        { input: pdf, filename: 'batch1.pdf', topicId: 'b_1' },
        { input: pptx, filename: 'batch2.pptx', topicId: 'b_2' },
        { input: new Uint8Array([1, 2]), filename: 'bad.exe', topicId: 'b_3' },
      ]);

      expect(batch).toHaveLength(3);
      expect(batch[0].fileType).toBe('pdf');
      expect(batch[0].extractedText).toContain('[Page 1]');
      expect(batch[1].fileType).toBe('pptx');
      expect(batch[1].extractedText).toContain('[Slide 1]');
      expect(batch[2].extractedText).toContain('Failed to parse document');
    });
  });
});
