/**
 * tests/stress/structuredMarkdownAdversarial.test.tsx
 * Empirical Challenger Test Harness: StructuredMarkdown (F24) Adversarial Stress Suite
 *
 * Comprehensive stress testing covering:
 * - Suite 1: Tables (alignments :---:, ---:, :---, ragged rows, empty cells, escaped pipes, adjacent text)
 * - Suite 2: Headings & False Headings (# through ######, inline tokens, hashtags without space)
 * - Suite 3: Lists (bulleted, numbered, multiline continuation, nested, non-list markers)
 * - Suite 4: Code Blocks & Copy Interaction (languages, copy button, empty, unclosed, token immunity)
 * - Suite 5: Badges & Citations Tokenization ([Source: ...], [Slide N], [Page N], multiple, links vs badges)
 * - Suite 6: Safe Rendering & Boundary Resilience (empty, whitespace, huge payloads, Unicode, XSS safety)
 * - Suite 7: Testing-Library Compatibility (plain paragraph getByText matching, container className)
 * - Suite 8: Blockquotes & Horizontal Rules (single/multiline blockquotes, hr separators)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StructuredMarkdown } from '@/components/StructuredMarkdown';

describe('Adversarial Stress Suite: StructuredMarkdown (F24)', () => {
  let originalClipboard: Clipboard | undefined;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  // =========================================================================
  // Suite 1: Tables Adversarial Stress
  // =========================================================================
  describe('Suite 1: Tables Adversarial Stress', () => {
    it('1.1 renders valid tables and applies alignment classes correctly', () => {
      const markdown = `
| Default Left | Left Aligned | Center Aligned | Right Aligned |
| --- | :--- | :---: | ---: |
| Data 1 | Data 2 | Data 3 | Data 4 |
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const table = container.querySelector('table');
      expect(table).not.toBeNull();

      const headers = container.querySelectorAll('th');
      expect(headers).toHaveLength(4);
      expect(headers[0].className).toContain('text-left');
      expect(headers[1].className).toContain('text-left');
      expect(headers[2].className).toContain('text-center');
      expect(headers[3].className).toContain('text-right');

      const cells = container.querySelectorAll('td');
      expect(cells).toHaveLength(4);
      expect(cells[0].className).toContain('text-left');
      expect(cells[1].className).toContain('text-left');
      expect(cells[2].className).toContain('text-center');
      expect(cells[3].className).toContain('text-right');
    });

    it('1.2 safely handles ragged tables where rows have fewer cells than headers', () => {
      const markdown = `
| Col A | Col B | Col C |
| --- | --- | --- |
| Only A |
| Only A | Only B |
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(2);

      // Row 1: only has 1 cell in markdown, should render 3 cells with empty strings for missing
      const row1Cells = rows[0].querySelectorAll('td');
      expect(row1Cells).toHaveLength(3);
      expect(row1Cells[0].textContent).toBe('Only A');
      expect(row1Cells[1].textContent).toBe('');
      expect(row1Cells[2].textContent).toBe('');

      // Row 2: has 2 cells, 3rd should be empty
      const row2Cells = rows[1].querySelectorAll('td');
      expect(row2Cells).toHaveLength(3);
      expect(row2Cells[0].textContent).toBe('Only A');
      expect(row2Cells[1].textContent).toBe('Only B');
      expect(row2Cells[2].textContent).toBe('');
    });

    it('1.3 safely handles ragged tables where rows have more cells than headers', () => {
      const markdown = `
| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 | Extra Cell 3 | Extra Cell 4 |
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      const cells = rows[0].querySelectorAll('td');
      // Truncated to header count
      expect(cells).toHaveLength(2);
      expect(cells[0].textContent).toBe('Cell 1');
      expect(cells[1].textContent).toBe('Cell 2');
    });

    it('1.4 renders tables with empty cells without throwing', () => {
      const markdown = `
| | Col 2 | |
| --- | --- | --- |
| | | Val 3 |
| Val 4 | | |
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const headers = container.querySelectorAll('th');
      expect(headers).toHaveLength(3);
      expect(headers[0].textContent).toBe('');
      expect(headers[1].textContent).toBe('Col 2');
      expect(headers[2].textContent).toBe('');

      const cells = container.querySelectorAll('td');
      expect(cells).toHaveLength(6);
      expect(cells[2].textContent).toBe('Val 3');
      expect(cells[3].textContent).toBe('Val 4');
    });

    it('1.5 handles escaped pipes and unusual pipe positions safely', () => {
      const markdown = `
| Metric | Formula \\| Description |
| --- | --- |
| Grade | Score / Total \\| Normalized |
`;
      expect(() => render(<StructuredMarkdown content={markdown} />)).not.toThrow();
      expect(screen.getByText(/Grade/)).toBeDefined();
    });

    it('1.6 parses tables directly adjacent to preceding and succeeding paragraphs without blank lines', () => {
      const markdown = `Preceding paragraph text directly before table.
| Col 1 | Col 2 |
| --- | --- |
| Val A | Val B |
Following paragraph text directly after table.`;

      const { container } = render(<StructuredMarkdown content={markdown} />);

      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0].textContent).toContain('Preceding paragraph text');
      expect(paragraphs[1].textContent).toContain('Following paragraph text');

      const table = container.querySelector('table');
      expect(table).not.toBeNull();
      expect(table?.textContent).toContain('Val A');
    });

    it('1.7 renders single-column tables and large multi-row tables (50 rows)', () => {
      const rowLines = Array.from({ length: 50 }, (_, i) => `| Item ${i + 1} | Val ${i + 1} |`).join(
        '\n'
      );
      const markdown = `
| Item | Value |
| :--- | :---: |
${rowLines}
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(50);
      expect(rows[0].textContent).toContain('Item 1');
      expect(rows[49].textContent).toContain('Item 50');
    });

    it('1.8 renders inline citations and bold inside table headers and data cells', () => {
      const markdown = `
| Resource | Attribution |
| --- | --- |
| **Syllabus** | [Source: Syllabus.pdf, p. 3] |
| *Slide Deck* | [Slide 14] |
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const strong = container.querySelector('strong');
      expect(strong).not.toBeNull();
      expect(strong?.textContent).toBe('Syllabus');

      const em = container.querySelector('em');
      expect(em).not.toBeNull();
      expect(em?.textContent).toBe('Slide Deck');

      const badges = container.querySelectorAll('[data-citation]');
      expect(badges).toHaveLength(2);
      expect(badges[0].textContent).toBe('[Source: Syllabus.pdf, p. 3]');
      expect(badges[1].textContent).toBe('[Slide 14]');
    });
  });

  // =========================================================================
  // Suite 2: Headings & False Headings
  // =========================================================================
  describe('Suite 2: Headings & False Headings', () => {
    it('2.1 renders headings from # (H1) through ###### (H6) with semantic tags', () => {
      const markdown = `
# Heading Level 1
## Heading Level 2
### Heading Level 3
#### Heading Level 4
##### Heading Level 5
###### Heading Level 6
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const h1 = container.querySelector('h1');
      expect(h1).not.toBeNull();
      expect(h1?.textContent).toBe('Heading Level 1');

      const h2 = container.querySelector('h2');
      expect(h2).not.toBeNull();
      expect(h2?.textContent).toBe('Heading Level 2');

      const h3 = container.querySelector('h3');
      expect(h3).not.toBeNull();
      expect(h3?.textContent).toBe('Heading Level 3');

      // H4 through H6 fall into h4 elements per design
      const h4List = container.querySelectorAll('h4');
      expect(h4List).toHaveLength(3);
      expect(h4List[0].textContent).toBe('Heading Level 4');
      expect(h4List[1].textContent).toBe('Heading Level 5');
      expect(h4List[2].textContent).toBe('Heading Level 6');
    });

    it('2.2 parses headings containing inline code, bold, and citations', () => {
      const markdown = `## Module 1: **Distributed** \`Consensus\` [Source: Week 1]`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const h2 = container.querySelector('h2');
      expect(h2).not.toBeNull();
      expect(h2?.querySelector('strong')?.textContent).toBe('Distributed');
      expect(h2?.querySelector('code')?.textContent).toBe('Consensus');
      expect(h2?.querySelector('[data-citation]')?.textContent).toBe('[Source: Week 1]');
    });

    it('2.3 treats hashtags without spaces as paragraphs, NOT headings', () => {
      const markdown = `
#notaheadingsince_no_space
##stillnotheading
#123 numerical hashtag
###cplusplus tag
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      expect(container.querySelector('h1')).toBeNull();
      expect(container.querySelector('h2')).toBeNull();
      expect(container.querySelector('h3')).toBeNull();

      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs.length).toBeGreaterThan(0);
      expect(container.textContent).toContain('#notaheadingsince_no_space');
      expect(container.textContent).toContain('###cplusplus tag');
    });

    it('2.4 handles headings with excessive leading/trailing whitespace cleanly', () => {
      const markdown = `#    Spaced Title   `;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const h1 = container.querySelector('h1');
      expect(h1).not.toBeNull();
      expect(h1?.textContent).toBe('Spaced Title');
    });
  });

  // =========================================================================
  // Suite 3: Lists (Bulleted, Numbered, Nested & Multiline)
  // =========================================================================
  describe('Suite 3: Lists (Bulleted, Numbered, Nested & Multiline)', () => {
    it('3.1 renders bulleted lists with -, *, and + markers in <ul>', () => {
      const markdown = `
- Hyphen item
* Asterisk item
+ Plus item
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const ul = container.querySelector('ul');
      expect(ul).not.toBeNull();
      expect(ul?.className).toContain('list-disc');

      const items = container.querySelectorAll('li');
      expect(items).toHaveLength(3);
      expect(items[0].textContent).toBe('Hyphen item');
      expect(items[1].textContent).toBe('Asterisk item');
      expect(items[2].textContent).toBe('Plus item');
    });

    it('3.2 renders numbered lists in <ol> with list-decimal', () => {
      const markdown = `
1. Step one
2. Step two
10. Step ten
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const ol = container.querySelector('ol');
      expect(ol).not.toBeNull();
      expect(ol?.className).toContain('list-decimal');

      const items = container.querySelectorAll('li');
      expect(items).toHaveLength(3);
      expect(items[0].textContent).toBe('Step one');
      expect(items[1].textContent).toBe('Step two');
      expect(items[2].textContent).toBe('Step ten');
    });

    it('3.3 handles multiline list items where text wraps to the next line', () => {
      const markdown = `
- First item has a long description
  that continues on the second line without a bullet.
- Second standalone item.
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const items = container.querySelectorAll('li');
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toContain('First item has a long description');
      expect(items[0].textContent).toContain('that continues on the second line');
      expect(items[1].textContent).toBe('Second standalone item.');
    });

    it('3.4 handles nested indented list items safely', () => {
      const markdown = `
- Root item 1
  - Child item 1.1
  - Child item 1.2
- Root item 2
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const items = container.querySelectorAll('li');
      expect(items).toHaveLength(4);
      expect(items[1].textContent).toBe('Child item 1.1');
      expect(items[2].textContent).toBe('Child item 1.2');
    });

    it('3.5 treats non-list punctuation markers as paragraphs, NOT list items', () => {
      const markdown = `
-not-a-list-marker
*not-a-list-marker
1.not-a-list-marker
+1234567890
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      expect(container.querySelector('ul')).toBeNull();
      expect(container.querySelector('ol')).toBeNull();
      expect(container.querySelector('li')).toBeNull();

      expect(container.textContent).toContain('-not-a-list-marker');
      expect(container.textContent).toContain('1.not-a-list-marker');
    });

    it('3.6 renders lists containing citations, bold, and code inside items', () => {
      const markdown = `
- Review chapter 4 **Concurrency** [Page 88]
- Run test with \`npm test\` [Source: README.md]
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const strong = container.querySelector('strong');
      expect(strong?.textContent).toBe('Concurrency');

      const code = container.querySelector('code');
      expect(code?.textContent).toBe('npm test');

      const badges = container.querySelectorAll('[data-citation]');
      expect(badges).toHaveLength(2);
      expect(badges[0].textContent).toBe('[Page 88]');
      expect(badges[1].textContent).toBe('[Source: README.md]');
    });
  });

  // =========================================================================
  // Suite 4: Code Blocks & Copy Interaction
  // =========================================================================
  describe('Suite 4: Code Blocks & Copy Interaction', () => {
    it('4.1 renders fenced code blocks with language header pill', () => {
      const markdown = '```typescript\nconst message: string = "Hello World";\nconsole.log(message);\n```';
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const langSpan = container.querySelector('span.uppercase');
      expect(langSpan).not.toBeNull();
      expect(langSpan?.textContent).toBe('typescript');

      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain('const message: string = "Hello World";');
    });

    it('4.2 renders fenced code block without language defaulting to CODE', () => {
      const markdown = '```\nplain text code block\n```';
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const langSpan = container.querySelector('span.uppercase');
      expect(langSpan?.textContent).toBe('code');
      expect(container.querySelector('code')?.textContent).toBe('plain text code block');
    });

    it('4.3 clicking copy button writes code to navigator.clipboard and updates button state', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      const markdown = '```json\n{\n  "status": "success"\n}\n```';
      render(<StructuredMarkdown content={markdown} />);

      const copyBtn = screen.getByRole('button', { name: /Kopieer/i });
      expect(copyBtn).toBeDefined();

      fireEvent.click(copyBtn);

      expect(writeTextMock).toHaveBeenCalledWith('{\n  "status": "success"\n}');

      await waitFor(() => {
        expect(screen.getByText('Gekopieerd!')).toBeDefined();
      });
    });

    it('4.4 handles clipboard writeText rejection gracefully without crashing', async () => {
      const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'));
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      const markdown = '```python\nprint("secure")\n```';
      render(<StructuredMarkdown content={markdown} />);

      const copyBtn = screen.getByRole('button', { name: /Kopieer/i });
      expect(() => fireEvent.click(copyBtn)).not.toThrow();
    });

    it('4.5 renders empty code blocks without error', () => {
      const markdown = '```\n```';
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toBe('');
    });

    it('4.6 handles unclosed code fences without infinite loop or crash', () => {
      const markdown = '```javascript\nfunction unclosed() {\n  return true;\n';
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.textContent).toContain('function unclosed()');
    });

    it('4.7 protects markdown tokens, pipes, and citations inside code blocks from formatting', () => {
      const markdown = '```markdown\n| Not | A | Table |\n| --- | --- |\n# Not A Heading\n- Not A List\n[Source: NotABadge]\n```';
      const { container } = render(<StructuredMarkdown content={markdown} />);

      expect(container.querySelector('table')).toBeNull();
      expect(container.querySelector('h1')).toBeNull();
      expect(container.querySelector('ul')).toBeNull();
      expect(container.querySelector('[data-citation]')).toBeNull();

      const pre = container.querySelector('pre');
      expect(pre?.textContent).toContain('| Not | A | Table |');
      expect(pre?.textContent).toContain('# Not A Heading');
      expect(pre?.textContent).toContain('[Source: NotABadge]');
    });
  });

  // =========================================================================
  // Suite 5: Badges & Citations Tokenization
  // =========================================================================
  describe('Suite 5: Badges & Citations Tokenization', () => {
    it('5.1 renders all academic citation badge variants', () => {
      const variants = [
        '[Source: Syllabus.pdf, p. 12]',
        '[Bron: Handboek Hoofdstuk 2]',
        '[Slide 4]',
        '[Page 42]',
        '[Pagina 100]',
        '[Chapter 3]',
        '[Hoofdstuk 5]',
        '[Lecture 7]',
        '[College 4]',
        '[Assignment 2]',
        '[Opdracht 1]',
        '[Source]',
        '[Bron]',
        '[Syllabus]',
      ];

      const markdown = variants.join('\n\n');
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const badges = container.querySelectorAll('[data-citation]');
      expect(badges).toHaveLength(variants.length);
      variants.forEach((v, idx) => {
        expect(badges[idx].textContent).toBe(v);
        expect(badges[idx].className).toContain('text-slate-500'); // no resolver: grey box, not a link
        expect(badges[idx].className).not.toContain('text-blue-600');
      });
    });

    it('5.2 renders multiple citation badges on a single line correctly', () => {
      const markdown = 'Primary proof in [Source: Paper.pdf] and secondary confirmation in [Slide 12].';
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const badges = container.querySelectorAll('[data-citation]');
      expect(badges).toHaveLength(2);
      expect(badges[0].textContent).toBe('[Source: Paper.pdf]');
      expect(badges[1].textContent).toBe('[Slide 12]');
      expect(container.textContent).toContain('Primary proof in');
      expect(container.textContent).toContain('and secondary confirmation in');
    });

    it('5.3 distinguishes markdown links from citation badges', () => {
      const markdown = 'Visit [Brightspace Documentation](https://community.d2l.com) for details.';
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const link = container.querySelector('a');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe('https://community.d2l.com');
      expect(link?.textContent).toBe('Brightspace Documentation');
      expect(container.querySelector('[data-citation]')).toBeNull();
    });

    it('5.4 preserves regular bracketed non-citation text without converting to badge', () => {
      const markdown = 'The array index [i] must satisfy [min..max] constraints.';
      const { container } = render(<StructuredMarkdown content={markdown} />);

      expect(container.querySelector('[data-citation]')).toBeNull();
      expect(container.textContent).toContain('[i]');
      expect(container.textContent).toContain('[min..max]');
    });
  });

  // =========================================================================
  // Suite 6: Safe Rendering & Boundary Resilience
  // =========================================================================
  describe('Suite 6: Safe Rendering & Boundary Resilience', () => {
    it('6.1 returns null for empty and whitespace-only strings', () => {
      const { container: c1 } = render(<StructuredMarkdown content="" />);
      expect(c1.firstChild).toBeNull();

      const { container: c2 } = render(<StructuredMarkdown content={"   \n\t   \r\n   "} />);
      expect(c2.firstChild).toBeNull();
    });

    it('6.2 handles undefined or null content gracefully without crashing', () => {
      const { container: c1 } = render(<StructuredMarkdown content={undefined as unknown as string} />);
      expect(c1.firstChild).toBeNull();

      const { container: c2 } = render(<StructuredMarkdown content={null as unknown as string} />);
      expect(c2.firstChild).toBeNull();
    });

    it('6.3 renders massive text payload (1,000 paragraphs, 50 KB) rapidly without stack overflow', () => {
      const paragraphs = Array.from(
        { length: 1000 },
        (_, i) => `Paragraph ${i}: Factual observation regarding system performance [Page ${i}].`
      ).join('\n\n');

      const startTime = performance.now();
      const { container } = render(<StructuredMarkdown content={paragraphs} />);
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(1000); // Must render in less than 1 second
      expect(container.querySelectorAll('p')).toHaveLength(1000);
      expect(container.querySelectorAll('[data-citation]')).toHaveLength(1000);
    });

    it('6.4 handles Unicode, emojis, RTL scripts, and math formulas cleanly', () => {
      const markdown = `
# 🚀 Multilingual & Math Test

- Emojis: 📚 ✨ 🔥 🎓 💡
- RTL Arabic: مرحباً بكم في المقرر الدراسي
- RTL Hebrew: שלום לכל הסטודנטים
- CJK: 课程概要 • 講義ノート • 강의 요약
- Math formulas: \`f(x) = ∫_0^∞ e^(-x²) dx = √π / 2\`
- Accents & Umlauts: Résumé, Über, Große, Niño, Café
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      expect(container.textContent).toContain('🚀 Multilingual & Math Test');
      expect(container.textContent).toContain('مرحباً بكم في المقرر الدراسي');
      expect(container.textContent).toContain('שלום לכל הסטודנטים');
      expect(container.textContent).toContain('课程概要');
      expect(container.textContent).toContain('Résumé');
    });

    it('6.5 escapes raw HTML / script tags safely (XSS immunity)', () => {
      const malicious = '<script>window.__pwned = true;</script><img src="x" onerror="alert(1)" />';
      const { container } = render(<StructuredMarkdown content={malicious} />);

      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
      expect(container.querySelector('script')).toBeNull();
      // Rendered safely as text content inside a paragraph
      expect(container.textContent).toContain('<script>');
    });
  });

  // =========================================================================
  // Suite 7: Testing-Library Compatibility
  // =========================================================================
  describe('Suite 7: Testing-Library Compatibility', () => {
    it('7.1 allows plain text paragraphs to be retrieved via exact getByText', () => {
      const text = 'The passing grade threshold is 55% across all coursework.';
      render(<StructuredMarkdown content={text} />);

      // Exactly as required by shadowDomMount.test.tsx integration test:
      const element = screen.getByText('The passing grade threshold is 55% across all coursework.');
      expect(element).toBeDefined();
      expect(element.tagName).toBe('P');
    });

    it('7.2 allows multi-line plain paragraphs to be retrieved via getByText', () => {
      const text = 'Line one of observation.\nLine two of observation.';
      render(<StructuredMarkdown content={text} />);

      const element = screen.getByText('Line one of observation.\nLine two of observation.', {
        collapseWhitespace: false,
      });
      expect(element).toBeDefined();
      expect(element.tagName).toBe('P');
    });

    it('7.3 allows inline elements to be queried directly by text', () => {
      const markdown = 'Summary: **Strict BLUF persona** [Source: AI Helper Guide].';
      render(<StructuredMarkdown content={markdown} />);

      expect(screen.getByText('Strict BLUF persona')).toBeDefined();
      expect(screen.getByText('[Source: AI Helper Guide]')).toBeDefined();
    });

    it('7.4 forwards custom className prop to root wrapper element', () => {
      const { container } = render(
        <StructuredMarkdown content="Sample text" className="custom-shadow-class border-red-500" />
      );

      const root = container.querySelector('.structured-markdown');
      expect(root?.className).toContain('custom-shadow-class');
      expect(root?.className).toContain('border-red-500');
    });
  });

  // =========================================================================
  // Suite 8: Blockquotes & Horizontal Rules
  // =========================================================================
  describe('Suite 8: Blockquotes & Horizontal Rules', () => {
    it('8.1 renders single and multiline blockquotes with styling', () => {
      const markdown = `
> "The only way to learn a new programming language is by writing programs in it."
> — Dennis Ritchie
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const quote = container.querySelector('blockquote');
      expect(quote).not.toBeNull();
      expect(quote?.className).toContain('border-blue-500');
      expect(quote?.textContent).toContain('Dennis Ritchie');
    });

    it('8.2 renders horizontal rules for ---, ***, and ___ dividers', () => {
      const markdown = `
Section A
---
Section B
***
Section C
___
Section D
`;
      const { container } = render(<StructuredMarkdown content={markdown} />);

      const hrs = container.querySelectorAll('hr');
      expect(hrs).toHaveLength(3);
    });
  });
});
