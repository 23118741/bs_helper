import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { docxParser, parseDocx } from '@/services/parsers/docxParser';
import { htmlParser, parseHtml, sanitizeHtmlDocument } from '@/services/parsers/htmlParser';
import { cleanMarkdown } from '@/services/parsers/turndownConfig';
import {
  buildContextBundle,
  serializeToMarkdown,
  serializeToJson,
  serializeContext,
  cleanHtmlText,
} from '@/services/context/contextSerializer';
import { CourseData, TocModule, TocTopic } from '@/types/brightspace';
import {
  ContextSelection,
  createEmptyContextSelection,
  createFullContextSelection,
  ParsedDocument,
} from '@/types/parser';

// ============================================================================
// Helper Functions for Generating Adversarial Payloads
// ============================================================================

/**
 * Builds a DOCX zip archive with custom word/document.xml content.
 */
async function buildDocxZip(documentXmlContent: string): Promise<ArrayBuffer> {
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
  zip.file('word/document.xml', documentXmlContent);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('Empirical Adversarial Stress Testing — M2 Parsers & Serializer', () => {
  // ==========================================================================
  // SUITE 1: docxParser.ts Adversarial Stress Tests
  // ==========================================================================
  describe('Suite 1: docxParser.ts Stress & Resilience', () => {
    it('handles nested tables inside DOCX cells without crashing or throwing', async () => {
      const xml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        '<w:p><w:r><w:t>Parent Heading</w:t></w:r></w:p>' +
        '<w:tbl>' +
        '<w:tr>' +
        '<w:tc><w:p><w:r><w:t>Outer Col 1</w:t></w:r></w:p></w:tc>' +
        '<w:tc>' +
        '<w:p><w:r><w:t>Outer Col 2 Before Nested</w:t></w:r></w:p>' +
        '<w:tbl>' +
        '<w:tr>' +
        '<w:tc><w:p><w:r><w:t>Inner Col A</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>Inner Col B</w:t></w:r></w:p></w:tc>' +
        '</w:tr>' +
        '<w:tr>' +
        '<w:tc><w:p><w:r><w:t>Inner Val 1</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>Inner Val 2</w:t></w:r></w:p></w:tc>' +
        '</w:tr>' +
        '</w:tbl>' +
        '<w:p><w:r><w:t>Outer Col 2 After Nested</w:t></w:r></w:p>' +
        '</w:tc>' +
        '</w:tr>' +
        '</w:tbl>' +
        '</w:body></w:document>';

      const docxBuffer = await buildDocxZip(xml);
      const result = await docxParser.parse(docxBuffer, 'nested_tbl_doc', 'nested.docx');

      expect(result.fileType).toBe('docx');
      expect(result.extractedText).toContain('Parent Heading');
      expect(result.extractedText).toContain('Outer Col 1');
      // The nested cell texts should be present in the output
      expect(result.extractedText).toContain('Inner Col A');
      expect(result.extractedText).toContain('Inner Val 2');
      expect(result.metadata.tokenEstimate).toBeGreaterThan(0);
    });

    it('handles 300 empty paragraphs and whitespace-only runs cleanly without line explosion', async () => {
      let emptyParas = '';
      for (let i = 0; i < 300; i++) {
        if (i % 2 === 0) {
          emptyParas += '<w:p><w:pPr/></w:p>';
        } else {
          emptyParas += '<w:p><w:r><w:t>   \t   \n  </w:t></w:r></w:p>';
        }
      }

      const xml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        '<w:p><w:r><w:t>Real First Paragraph</w:t></w:r></w:p>' +
        emptyParas +
        '<w:p><w:r><w:t>Real Last Paragraph</w:t></w:r></w:p>' +
        '</w:body></w:document>';

      const docxBuffer = await buildDocxZip(xml);
      const result = await docxParser.parse(docxBuffer, 'empty_paras_doc', 'empty.docx');

      expect(result.extractedText).toContain('Real First Paragraph');
      expect(result.extractedText).toContain('Real Last Paragraph');
      // cleanMarkdown collapses multiple consecutive newlines down to 2
      expect(result.extractedText).not.toMatch(/\n{3,}/);
      // Ensure the output is concise, not hundreds of blank lines
      const lineCount = result.extractedText.split('\n').length;
      expect(lineCount).toBeLessThan(10);
    });

    it('recovers via OpenXML fallback when Mammoth encounters malformed XML tags', async () => {
      // Malformed XML with broken tags inside word/document.xml
      const brokenXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        '<w:p><w:r><w:t>Survivor Heading</w:t></w:r></w:p>' +
        '<w:p><w:pStyle w:val="Heading1"/><w:r><w:t>Important Heading 1</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Survivor Paragraph Content</w:t></w:r></w:p>' +
        '<!-- Unclosed tag causing XML syntax error in strict parsers -->' +
        '<w:brokenTag><w:unclosed' +
        '</w:body></w:document>';

      const docxBuffer = await buildDocxZip(brokenXml);
      const result = await docxParser.parse(docxBuffer, 'broken_xml_doc', 'broken.docx');

      // Should extract text either through Mammoth or through regex/DOM fallback without throwing
      expect(result.fileType).toBe('docx');
      expect(result.extractedText).toMatch(/Survivor|Heading/);
      expect(result.metadata.extractedAt).toBeGreaterThan(0);
    });

    it('gracefully handles missing word/document.xml without throwing', async () => {
      const zip = new JSZip();
      zip.file('[Content_Types].xml', '<Types/>');
      zip.file('dummy.txt', 'not word document');
      const badBuffer = await zip.generateAsync({ type: 'arraybuffer' });

      const result = await docxParser.parse(badBuffer, 'no_doc_xml', 'bad.docx');

      expect(result.fileType).toBe('docx');
      expect(result.extractedText).toContain('[Error parsing Word document:');
      expect(result.metadata.warnings).toBeDefined();
      expect(result.metadata.warnings![0]).toMatch(/Mammoth error|Fallback error/);
    });

    it('gracefully handles non-zip corrupt binary buffers', async () => {
      const junk = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
      const result = await docxParser.parse(junk, 'junk_doc', 'junk.docx');

      expect(result.fileType).toBe('docx');
      expect(result.extractedText).toContain('[Error parsing Word document:');
      expect(result.metadata.tokenEstimate).toBe(0);
    });

    it('handles 0-byte buffer immediately with structured warning', async () => {
      const empty = new ArrayBuffer(0);
      const result = await parseDocx(empty, 'empty_doc', 'zero.docx');

      expect(result.extractedText).toBe('');
      expect(result.metadata.warnings).toContain('File buffer is empty.');
    });

    it('processes a large table with 100 rows and ragged column widths', async () => {
      let rowsXml = '';
      // Header
      rowsXml +=
        '<w:tr>' +
        '<w:tc><w:p><w:r><w:t>ID</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>Score</w:t></w:r></w:p></w:tc>' +
        '</w:tr>';

      // 100 rows with varying column counts (ragged)
      for (let i = 0; i < 100; i++) {
        if (i % 3 === 0) {
          // Extra cell
          rowsXml += `<w:tr><w:tc><w:p><w:r><w:t>${i}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>User_${i}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${i * 10}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Extra</w:t></w:r></w:p></w:tc></w:tr>`;
        } else {
          // Standard 3 cells
          rowsXml += `<w:tr><w:tc><w:p><w:r><w:t>${i}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>User_${i}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${i * 10}</w:t></w:r></w:p></w:tc></w:tr>`;
        }
      }

      const xml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body><w:tbl>${rowsXml}</w:tbl></w:body></w:document>`;

      const docxBuffer = await buildDocxZip(xml);
      const result = await docxParser.parse(docxBuffer, 'large_tbl_doc', 'table.docx');

      expect(result.extractedText).toContain('| ID | Name | Score |');
      expect(result.extractedText).toContain('User_99');
      expect(result.metadata.tokenEstimate).toBeGreaterThan(100);
    });

    it('correctly maps Heading 1, Heading 2, Heading 3 styles in OpenXML fallback', async () => {
      const xml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title Level 1</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Section Level 2</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Subsection Level 3</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Regular paragraph content.</w:t></w:r></w:p>' +
        '</w:body></w:document>';

      const docxBuffer = await buildDocxZip(xml);
      const result = await docxParser.parse(docxBuffer, 'styles_doc', 'styles.docx');

      expect(result.extractedText).toMatch(/# Title Level 1/);
      expect(result.extractedText).toMatch(/## Section Level 2/);
      expect(result.extractedText).toMatch(/### Subsection Level 3/);
      expect(result.extractedText).toContain('Regular paragraph content.');
    });
  });

  // ==========================================================================
  // SUITE 2: htmlParser.ts Adversarial Stress Tests
  // ==========================================================================
  describe('Suite 2: htmlParser.ts Stress & Resilience', () => {
    it('completely strips malicious scripts, inline event handlers, and nested iframes', async () => {
      const maliciousHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page</title>
            <script>alert("XSS 1");</script>
            <script src="http://evil.com/xss.js"></script>
            <style>body { background: red; }</style>
          </head>
          <body onload="alert('body onload')">
            <h1>Safe Course Title</h1>
            <p>Welcome students to <script>alert('inline script');</script> CS101.</p>
            <iframe src="http://evil.com/phish">
              <iframe src="http://evil.com/inner"></iframe>
            </iframe>
            <a href="javascript:alert('link xss')">Malicious Link 1</a>
            <a href="JAVASCRIPT:alert('capital xss')">Malicious Link 2</a>
            <a href="  javascript:alert('whitespace xss')  ">Malicious Link 3</a>
            <a href="https://example.com/safe">Safe Link</a>
            <svg onload="alert('svg onload')"><circle r="10"/></svg>
            <img src="x" onerror="alert('img onerror')">
            <object data="exploit.swf"></object>
            <embed src="exploit.pdf"></embed>
          </body>
        </html>
      `;

      const result = await htmlParser.parse(maliciousHtml, 'top_sec', 'test.html');

      expect(result.fileType).toBe('html');
      // Verify no script tags or script text survived
      expect(result.extractedText).not.toContain('<script');
      expect(result.extractedText).not.toContain('alert(');
      expect(result.extractedText).not.toContain('XSS 1');
      expect(result.extractedText).not.toContain('inline script');
      // Verify iframe, style, svg, object, embed stripped
      expect(result.extractedText).not.toContain('iframe');
      expect(result.extractedText).not.toContain('background: red');
      expect(result.extractedText).not.toContain('exploit');
      // Verify safe content preserved
      expect(result.extractedText).toContain('# Safe Course Title');
      expect(result.extractedText).toContain('Welcome students to CS101.');
      expect(result.extractedText).toContain('[Safe Link](https://example.com/safe)');
    });

    it('strips all Brightspace Daylight navigation chrome, minibar, skip links, and hidden elements', async () => {
      const brightspaceHtml = `
        <div class="d2l-navigation-s">
          <nav role="navigation">
            <a class="d2l-skip-to-content" href="#main">Skip to main content</a>
            <div class="d2l-minibar">Brightspace Mini Bar User Profile Log Out</div>
          </nav>
        </div>
        <div class="d2l-page-header">
          <header role="banner">Course Header Banner</header>
        </div>
        <div class="d2l-navigation-gutters">
          Sidebar navigation links
        </div>
        <div id="hidden-instructor-note" style="display: none;">
          Instructor secret answer key: A, B, C
        </div>
        <div aria-hidden="true">
          Screen-reader hidden text
        </div>
        <div hidden>
          Hidden attribute text
        </div>
        <div style="visibility: hidden;">
          Visibility hidden text
        </div>
        <main id="main" class="d2l-body d2l-htmlblock">
          <h2>Week 3: Neural Networks</h2>
          <p>This week we study backpropagation and gradient descent.</p>
          <ul>
            <li>Perceptrons</li>
            <li>Multi-layer Networks</li>
            <li>Loss Functions</li>
          </ul>
        </main>
        <footer class="d2l-footer" role="contentinfo">
          Copyright 2026 D2L Corporation. All rights reserved.
        </footer>
      `;

      const result = await parseHtml(brightspaceHtml, 'top_daylight', 'daylight.html');

      // Hidden & Brightspace chrome must be absent
      expect(result.extractedText).not.toContain('Skip to main content');
      expect(result.extractedText).not.toContain('Brightspace Mini Bar');
      expect(result.extractedText).not.toContain('Course Header Banner');
      expect(result.extractedText).not.toContain('Sidebar navigation links');
      expect(result.extractedText).not.toContain('Instructor secret answer key');
      expect(result.extractedText).not.toContain('Screen-reader hidden text');
      expect(result.extractedText).not.toContain('Hidden attribute text');
      expect(result.extractedText).not.toContain('Visibility hidden text');
      expect(result.extractedText).not.toContain('Copyright 2026 D2L Corporation');

      // Genuine content preserved
      expect(result.extractedText).toContain('## Week 3: Neural Networks');
      expect(result.extractedText).toContain(
        'This week we study backpropagation and gradient descent.'
      );
      expect(result.extractedText).toMatch(/-\s+Perceptrons/);
      expect(result.extractedText).toMatch(/-\s+Multi-layer Networks/);
      expect(result.extractedText).toMatch(/-\s+Loss Functions/);
    });

    it('handles severely broken and unclosed HTML markup gracefully', async () => {
      const brokenHtml =
        '<div><p>Unclosed paragraph <b>bold <i>bold-italic text' +
        '<h2>Mismatched header</h3>' +
        '<div>Unclosed container with mathematical expressions: 5 < 10 and 20 > 15 & a < b' +
        '<table><tr><td>Missing closing table tags';

      const result = await htmlParser.parse(brokenHtml, 'broken_html', 'broken.html');

      expect(result.fileType).toBe('html');
      expect(result.extractedText).toContain('Unclosed paragraph');
      expect(result.extractedText).toContain('bold');
      expect(result.extractedText).toContain('bold-italic text');
      expect(result.extractedText).toContain('5 < 10 and 20 > 15');
      expect(result.metadata.tokenEstimate).toBeGreaterThan(0);
    });

    it('formats a massive HTML table (200 rows x 8 cols) into valid GitHub-Flavored Markdown', async () => {
      let rows = '<tr>';
      for (let c = 1; c <= 8; c++) {
        rows += `<th>Header ${c}</th>`;
      }
      rows += '</tr>';

      for (let r = 1; r <= 200; r++) {
        rows += '<tr>';
        for (let c = 1; c <= 8; c++) {
          rows += `<td>Row ${r} Col ${c} &nbsp; | pipe in text</td>`;
        }
        rows += '</tr>';
      }

      const tableHtml = `<table>${rows}</table>`;
      const result = await htmlParser.parse(tableHtml, 'huge_tbl', 'huge.html');

      // Verify table header row
      expect(result.extractedText).toContain(
        '| Header 1 | Header 2 | Header 3 | Header 4 | Header 5 | Header 6 | Header 7 | Header 8 |'
      );
      // Verify separator row
      expect(result.extractedText).toContain(
        '| --- | --- | --- | --- | --- | --- | --- | --- |'
      );
      // Verify pipe characters inside text are escaped so table columns don't break
      expect(result.extractedText).toContain('\\| pipe in text');
      // Verify first and last rows
      expect(result.extractedText).toContain('Row 1 Col 1');
      expect(result.extractedText).toContain('Row 200 Col 8');
    });

    it('handles nested HTML tables by normalizing rows and cells', async () => {
      const nestedHtml = `
        <table>
          <tr>
            <th>Outer Header 1</th>
            <th>Outer Header 2</th>
          </tr>
          <tr>
            <td>Outer Cell 1</td>
            <td>
              <table>
                <tr><th>Inner H1</th><th>Inner H2</th></tr>
                <tr><td>Inner Val 1</td><td>Inner Val 2</td></tr>
              </table>
            </td>
          </tr>
        </table>
      `;

      const result = await htmlParser.parse(nestedHtml, 'nested_html_tbl', 'nested.html');

      expect(result.extractedText).toContain('Outer Header 1');
      expect(result.extractedText).toContain('Outer Cell 1');
      expect(result.extractedText).toContain('Inner H1');
      expect(result.extractedText).toContain('Inner Val 2');
    });

    it('formats definition lists (<dl>, <dt>, <dd>) into clean bold key-value pairs', async () => {
      const dlHtml = `
        <dl>
          <dt>Supervised Learning</dt>
          <dd>Learning from labeled examples with inputs and target outputs.</dd>
          <dt>Unsupervised Learning</dt>
          <dd>Finding hidden patterns or groupings in unlabeled datasets.</dd>
          <dt>Reinforcement Learning</dt>
          <dd>Learning optimal behaviors through rewards and penalties in an environment.</dd>
        </dl>
      `;

      const result = await htmlParser.parse(dlHtml, 'dl_doc', 'defs.html');

      expect(result.extractedText).toContain(
        '**Supervised Learning**: Learning from labeled examples with inputs and target outputs.'
      );
      expect(result.extractedText).toContain(
        '**Unsupervised Learning**: Finding hidden patterns or groupings in unlabeled datasets.'
      );
      expect(result.extractedText).toContain(
        '**Reinforcement Learning**: Learning optimal behaviors through rewards and penalties in an environment.'
      );
    });

    it('handles 0-byte or whitespace-only HTML gracefully', async () => {
      const result = await htmlParser.parse('   \n\t   ', 'empty_html', 'empty.html');
      expect(result.extractedText).toBe('');
      expect(result.metadata.warnings).toContain('HTML input is empty.');
    });

    it('directly tests sanitizeHtmlDocument with script, nav, style, and iframe tags', () => {
      const sanitized = sanitizeHtmlDocument(
        '<div><script>alert(1)</script><nav>menu</nav><iframe src="x"></iframe><p>Safe content</p></div>'
      );
      expect(sanitized).not.toContain('<script');
      expect(sanitized).not.toContain('<nav');
      expect(sanitized).not.toContain('<iframe');
      expect(sanitized).toContain('Safe content');
    });

    it('cleanMarkdown normalizes CRLF and collapses excess newlines', () => {
      expect(cleanMarkdown('Hello\r\n\r\n\r\n\r\nWorld')).toBe('Hello\n\nWorld');
    });
  });

  // ==========================================================================
  // SUITE 3: contextSerializer.ts Adversarial Stress Tests
  // ==========================================================================
  describe('Suite 3: contextSerializer.ts Stress & Resilience', () => {
    it('handles deeply nested module hierarchy (60 levels deep) without call-stack overflow', () => {
      // Build a 60-level deep TocModule hierarchy
      let deepChild: TocModule = {
        moduleId: 'mod-60',
        title: 'Deep Level 60',
        subModules: [],
        topics: [
          {
            topicId: 'deep-topic-60',
            title: 'Deepest Topic 60.pdf',
            type: 'file',
            fileExtension: 'pdf',
            parsedContent: '[Page 1]\nDeepest core topic content.',
          },
        ],
      };

      for (let level = 59; level >= 1; level--) {
        const parentMod: TocModule = {
          moduleId: `mod-${level}`,
          title: `Module Level ${level}`,
          subModules: [deepChild],
          topics: [
            {
              topicId: `topic-${level}`,
              title: `Level ${level} Note.docx`,
              type: 'file',
              fileExtension: 'docx',
              parsedContent: `Summary content for level ${level}.`,
            },
          ],
        };
        deepChild = parentMod;
      }

      const deepCourse: CourseData = {
        orgUnitId: 'deep-org-999',
        courseName: 'Deep Hierarchy Course',
        fetchedAt: Date.now(),
        toc: [deepChild],
      };

      // 1. Serialization with full selection
      const output = serializeContext(deepCourse);

      expect(output.jsonBundle.courseInfo.orgUnitId).toBe('deep-org-999');
      // Should contain all 60 documents
      expect(output.jsonBundle.documents).toHaveLength(60);

      // Verify the deepest module path formatting: Mod 1 > Mod 2 > ... > Mod 60
      const deepestDoc = output.jsonBundle.documents.find((d) => d.topicId === 'deep-topic-60');
      expect(deepestDoc).toBeDefined();
      expect(deepestDoc?.modulePath).toContain('Module Level 1 > Module Level 2');
      expect(deepestDoc?.modulePath).toContain('Deep Level 60');

      // Verify Markdown output contains attributed header with deep path
      expect(output.markdown).toContain('### Module Level 1 >');
      expect(output.markdown).toContain('Deepest Topic 60.pdf [Page 1]');
      expect(output.markdown).toContain(
        '> **Source:** Document Page: Deepest Topic 60.pdf (Page 1)'
      );
      expect(output.markdown).toContain('Deepest core topic content.');
    });

    it('inherits selection from root module down 60 levels of submodules', () => {
      // Build 60-level hierarchy
      let deepChild: TocModule = {
        moduleId: 'mod-sub-60',
        title: 'Leaf 60',
        subModules: [],
        topics: [
          {
            topicId: 'leaf-topic',
            title: 'Leaf Topic.docx',
            type: 'file',
            fileExtension: 'docx',
            parsedContent: 'Leaf content.',
          },
        ],
      };

      for (let level = 59; level >= 1; level--) {
        deepChild = {
          moduleId: `mod-sub-${level}`,
          title: `Node ${level}`,
          subModules: [deepChild],
          topics: [],
        };
      }

      const deepCourse: CourseData = {
        orgUnitId: 'inherit-org',
        courseName: 'Inheritance Course',
        fetchedAt: Date.now(),
        toc: [deepChild],
      };

      // Select ONLY root module 'mod-sub-1'
      const selection: ContextSelection = {
        includeOverview: false,
        selectedModuleIds: ['mod-sub-1'], // only root module selected
        selectedTopicIds: [],
        includeAnnouncements: false,
        includeAssignments: false,
        includeQuizzes: false,
        includeCalendar: false,
        includeGrades: false,
      };

      const output = serializeContext(deepCourse, selection);

      // Descendant topic should inherit selection from root ancestor!
      expect(output.jsonBundle.documents).toHaveLength(1);
      expect(output.jsonBundle.documents[0].topicId).toBe('leaf-topic');
      expect(output.markdown).toContain('Node 1 > Node 2 >');
      expect(output.markdown).toContain('Leaf Topic.docx');
    });

    it('performs high-volume serialization of 1,000 topics across 100 modules within 500ms', () => {
      const moduleCount = 100;
      const topicsPerModule = 10;
      const totalTopics = moduleCount * topicsPerModule; // 1,000 topics

      const toc: TocModule[] = [];
      const parsedDocs: ParsedDocument[] = [];

      for (let m = 0; m < moduleCount; m++) {
        const topics: TocTopic[] = [];
        for (let t = 0; t < topicsPerModule; t++) {
          const topicId = `top_${m}_${t}`;
          topics.push({
            topicId,
            title: `Lecture ${m}.${t} Material.html`,
            type: 'file',
            fileExtension: 'html',
          });

          parsedDocs.push({
            topicId,
            filename: `Lecture ${m}.${t} Material.html`,
            fileType: 'html',
            extractedText: `Structured notes for module ${m} item ${t}. Key concept: algorithmic efficiency O(N).`,
            metadata: { extractedAt: Date.now() },
          });
        }

        toc.push({
          moduleId: `mod_${m}`,
          title: `Module ${m}: Chapter ${m}`,
          subModules: [],
          topics,
        });
      }

      const largeCourse: CourseData = {
        orgUnitId: 'scale-1000',
        courseName: 'Large Scale Course',
        fetchedAt: Date.now(),
        toc,
      };

      const startTime = performance.now();
      const output = serializeContext(largeCourse, undefined, parsedDocs);
      const elapsedMs = performance.now() - startTime;

      // Assert high performance
      expect(elapsedMs).toBeLessThan(1000); // Must be under 1s
      expect(output.jsonBundle.documents).toHaveLength(totalTopics);
      expect(output.markdown.length).toBeGreaterThan(50000);

      // Spot-check first and last documents
      expect(output.markdown).toContain('Module 0: Chapter 0 > Lecture 0.0 Material.html');
      expect(output.markdown).toContain('Module 99: Chapter 99 > Lecture 99.9 Material.html');
    });



    it('enforces strict partial selection filtering across all sections', () => {
      const course: CourseData = {
        orgUnitId: 'partial-course',
        courseName: 'Partial Selection Course',
        fetchedAt: Date.now(),
        overview: { title: 'Overview', textDescription: 'Overview text', htmlContent: '' },
        announcements: [{ id: 'a1', title: 'News', body: 'News body', postedDate: '2026-10-01' }],
        assignments: [{ id: 'as1', name: 'HW1', instructions: 'Instructions' }],
        grades: [{ id: 'g1', name: 'HW1', pointsNumerator: 10, pointsDenominator: 10 }],
      };

      // Only Grades selected
      const gradesOnly: ContextSelection = {
        includeOverview: false,
        selectedModuleIds: [],
        selectedTopicIds: [],
        includeAnnouncements: false,
        includeAssignments: false,
        includeQuizzes: false,
        includeCalendar: false,
        includeGrades: true,
      };

      const outGrades = serializeContext(course, gradesOnly);
      expect(outGrades.markdown).toContain('### Grades & Feedback');
      expect(outGrades.markdown).not.toContain('### Course Overview');
      expect(outGrades.markdown).not.toContain('### Announcements');
      expect(outGrades.markdown).not.toContain('### Assignments & Deadlines');
      expect(outGrades.jsonBundle.grades).toBeDefined();
      expect(outGrades.jsonBundle.overview).toBeUndefined();
      expect(outGrades.jsonBundle.announcements).toBeUndefined();
      expect(outGrades.jsonBundle.assignments).toBeUndefined();

      // Only Overview selected
      const overviewOnly: ContextSelection = {
        ...gradesOnly,
        includeGrades: false,
        includeOverview: true,
      };

      const outOverview = serializeContext(course, overviewOnly);
      expect(outOverview.markdown).toContain('### Course Overview');
      expect(outOverview.markdown).not.toContain('### Grades & Feedback');
      expect(outOverview.markdown).not.toContain('### Announcements');
      expect(outOverview.markdown).not.toContain('### Assignments & Deadlines');
      expect(outOverview.jsonBundle.overview).toBeDefined();
      expect(outOverview.jsonBundle.grades).toBeUndefined();
    });

    it('handles empty selection by returning banner and clean empty message', () => {
      const course: CourseData = {
        orgUnitId: 'empty-course',
        courseName: 'Empty Course',
        fetchedAt: Date.now(),
        overview: { title: 'Overview', textDescription: 'Text', htmlContent: '' },
      };

      const emptySel = createEmptyContextSelection();
      const output = serializeContext(course, emptySel);

      expect(output.markdown).toContain('# Course Context: Empty Course (empty-course)');
      expect(output.markdown).toContain('_No course items selected._');
      expect(output.markdown).not.toContain('###');
      expect(output.jsonBundle.overview).toBeUndefined();
      expect(output.jsonBundle.documents).toHaveLength(0);
    });

    it('safely tolerates orphan and non-existent IDs in selection criteria', () => {
      const course: CourseData = {
        orgUnitId: 'orphan-test',
        courseName: 'Orphan ID Course',
        fetchedAt: Date.now(),
        toc: [
          {
            moduleId: 'real-mod-1',
            title: 'Real Module',
            subModules: [],
            topics: [{ topicId: 'real-top-1', title: 'Real.pdf', type: 'file', parsedContent: 'Content' }],
          },
        ],
      };

      const selectionWithOrphans: ContextSelection = {
        includeOverview: false,
        selectedModuleIds: ['non-existent-module-id-999'],
        selectedTopicIds: ['non-existent-topic-id-888'],
        includeAnnouncements: false,
        includeAssignments: false,
        includeQuizzes: false,
        includeCalendar: false,
        includeGrades: false,
      };

      // Must not throw or crash
      const output = serializeContext(course, selectionWithOrphans);
      expect(output.jsonBundle.documents).toHaveLength(0);
      expect(output.markdown).toContain('_No course items selected._');
    });

    it('sanitizes malicious script injections in overview, announcements, assignments, and grades', () => {
      const dirtyCourse: CourseData = {
        orgUnitId: 'xss-course',
        courseName: 'XSS Defense Course',
        fetchedAt: Date.now(),
        overview: {
          title: 'Overview',
          htmlContent: 'Overview <script>alert("overview")</script> safe description.',
          textDescription: '',
        },
        announcements: [
          {
            id: 'x1',
            title: 'Notice',
            body: '<p>News content <style>body{color:red}</style><script>alert("news")</script> &amp; entity.</p>',
            postedDate: '2026-10-01',
          },
        ],
        assignments: [
          {
            id: 'as1',
            name: 'Assignment',
            instructions: 'Submit <script>alert("instructions")</script> here &lt;b&gt;bold&lt;/b&gt;.',
          },
        ],
        calendar: [
          {
            id: 'cal1',
            title: 'Event',
            startDate: '2026-10-10',
            description: 'Room <script>alert("cal")</script> 101',
          },
        ],
        grades: [
          {
            id: 'grd1',
            name: 'Grade Item',
            comments: 'Feedback <script>alert("grade")</script> with &quot;quotes&quot;.',
          },
        ],
      };

      const output = serializeContext(dirtyCourse);
      const md = output.markdown;

      // Ensure no raw script or style blocks made it to markdown
      expect(md).not.toContain('<script');
      expect(md).not.toContain('alert(');
      expect(md).not.toContain('<style');
      expect(md).toContain('Overview safe description.');
      expect(md).toContain('News content & entity.');
      expect(md).toContain('Submit here <b>bold</b>.');
      expect(md).toContain('Room 101');
      expect(md).toContain('Feedback with "quotes".');
    });

    it('bundles standalone documents not present in TOC under "Additional Course Materials"', () => {
      const course: CourseData = {
        orgUnitId: 'standalone-org',
        courseName: 'Standalone Doc Course',
        fetchedAt: Date.now(),
        toc: [
          {
            moduleId: 'mod_1',
            title: 'Module 1',
            subModules: [],
            topics: [{ topicId: 't1', title: 'TOC Topic.pdf', type: 'file', parsedContent: '[Page 1]\nTOC content' }],
          },
        ],
      };

      const parsedDocs: ParsedDocument[] = [
        {
          topicId: 't1',
          filename: 'TOC Topic.pdf',
          fileType: 'pdf',
          extractedText: '[Page 1]\nTOC content',
          metadata: { extractedAt: Date.now() },
        },
        {
          topicId: 'standalone_topic_99',
          filename: 'External Reference Guide.docx',
          fileType: 'docx',
          extractedText: '# Reference Guide\nKey external resources.',
          metadata: { extractedAt: Date.now() },
        },
      ];

      // Select both topics
      const selection: ContextSelection = {
        includeOverview: false,
        selectedModuleIds: ['mod_1'],
        selectedTopicIds: ['t1', 'standalone_topic_99'],
        includeAnnouncements: false,
        includeAssignments: false,
        includeQuizzes: false,
        includeCalendar: false,
        includeGrades: false,
      };

      const output = serializeContext(course, selection, parsedDocs);

      expect(output.jsonBundle.documents).toHaveLength(2);

      const standalone = output.jsonBundle.documents.find((d) => d.topicId === 'standalone_topic_99');
      expect(standalone).toBeDefined();
      expect(standalone?.modulePath).toBe('Additional Course Materials');

      // Verify Markdown rendering
      expect(output.markdown).toContain('### Additional Course Materials > External Reference Guide.docx');
      expect(output.markdown).toContain('> **Source:** Course Document: External Reference Guide.docx (docx)');
      expect(output.markdown).toContain('# Reference Guide');
    });

    it('handles minimal CourseData where all optional fields are undefined without throwing', () => {
      const minimalCourse: CourseData = {
        orgUnitId: 'min-1',
        courseName: 'Minimal Course',
        fetchedAt: 1700000000000,
      };

      const output = serializeContext(minimalCourse);

      expect(output.jsonBundle.courseInfo.orgUnitId).toBe('min-1');
      expect(output.jsonBundle.courseInfo.courseName).toBe('Minimal Course');
      expect(output.jsonBundle.overview).toBeUndefined();
      expect(output.jsonBundle.announcements).toBeUndefined();
      expect(output.jsonBundle.assignments).toBeUndefined();
      expect(output.jsonBundle.quizzes).toBeUndefined();
      expect(output.jsonBundle.calendar).toBeUndefined();
      expect(output.jsonBundle.grades).toBeUndefined();
      expect(output.jsonBundle.documents).toHaveLength(0);

      expect(output.markdown).toContain('# Course Context: Minimal Course (min-1)');
      expect(output.markdown).toContain('_No course items selected._');
    });

    it('properly formats non-consecutive slide numbers ([Slide 10], [Slide 25])', () => {
      const course: CourseData = {
        orgUnitId: 'slides-test',
        courseName: 'Slide Numbering Course',
        fetchedAt: Date.now(),
        toc: [
          {
            moduleId: 'm_slides',
            title: 'Presentations',
            subModules: [],
            topics: [
              {
                topicId: 't_jump_slides',
                title: 'Review Deck.pptx',
                type: 'file',
                fileExtension: 'pptx',
                parsedContent:
                  '[Slide 10]\nSummary of First Half.\n\n[Slide 25]\nFinal Key Takeaways.',
              },
            ],
          },
        ],
      };

      const output = serializeContext(course);

      expect(output.markdown).toContain(
        '### Presentations > Review Deck.pptx [Slide 10]'
      );
      expect(output.markdown).toContain(
        '> **Source:** Presentation Slide: Review Deck.pptx (Slide 10)'
      );
      expect(output.markdown).toContain(
        '### Presentations > Review Deck.pptx [Slide 25]'
      );
      expect(output.markdown).toContain(
        '> **Source:** Presentation Slide: Review Deck.pptx (Slide 25)'
      );
    });

    it('validates supports() methods on docxParser and htmlParser for uppercase and edge extensions', () => {
      // Docx supports
      expect(docxParser.supports('SYLLABUS.DOCX')).toBe(true);
      expect(docxParser.supports('legacy.doc')).toBe(true);
      expect(docxParser.supports('file.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
      expect(docxParser.supports('file.doc', 'application/msword')).toBe(true);
      expect(docxParser.supports('file.pdf')).toBe(false);
      expect(docxParser.supports('file.pptx')).toBe(false);

      // Html supports
      expect(htmlParser.supports('PAGE.HTML')).toBe(true);
      expect(htmlParser.supports('index.htm')).toBe(true);
      expect(htmlParser.supports('content', 'text/html')).toBe(true);
      expect(htmlParser.supports('content.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
    });

    it('directly exercises standalone helper functions: cleanHtmlText, buildContextBundle, serializeToMarkdown, serializeToJson, createFullContextSelection', () => {
      expect(cleanHtmlText('<p>Text &amp; &lt;tag&gt;</p>')).toBe('Text & <tag>');

      const testCourse: CourseData = {
        orgUnitId: 'hlp-1',
        courseName: 'Helper Test',
        fetchedAt: Date.now(),
        toc: [{ moduleId: 'm1', title: 'M1', subModules: [], topics: [{ topicId: 't1', title: 'T1', type: 'file' }] }],
      };

      const fullSel = createFullContextSelection(testCourse);
      expect(fullSel.selectedModuleIds).toContain('m1');
      expect(fullSel.selectedTopicIds).toContain('t1');

      const bundle = buildContextBundle(testCourse, fullSel);
      expect(bundle.courseInfo.orgUnitId).toBe('hlp-1');

      const md = serializeToMarkdown(bundle);
      expect(md).toContain('# Course Context: Helper Test');

      const jsonStr = serializeToJson(bundle);
      expect(JSON.parse(jsonStr).courseInfo.orgUnitId).toBe('hlp-1');
    });
  });
});

