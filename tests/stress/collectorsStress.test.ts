import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  collectCourseData,
  stripHtml,
  detectTopicType,
  normalizeTopic,
  normalizeModule,
  extractDomFallbackText,
  ValenceClientInterface,
} from '@/services/brightspace/collectors';

describe('Empirical Stress Testing — collectors.ts', () => {
  let mockClient: ValenceClientInterface;

  beforeEach(() => {
    mockClient = {
      getVersions: vi.fn().mockResolvedValue({ le: '1.74', lp: '1.45' }),
      get: vi.fn().mockResolvedValue([]),
    };
  });

  // =========================================================================
  // SUITE 1: HTTP Error Matrix (401, 403, 404, 500, Timeouts)
  // =========================================================================
  describe('1. Partial & Total Endpoint Failures Matrix', () => {
    const errorCodes = [
      { code: 401, name: 'Unauthorized / Session Expired' },
      { code: 403, name: 'Forbidden' },
      { code: 404, name: 'Not Found' },
      { code: 500, name: 'Internal Server Error' },
      { code: 502, name: 'Bad Gateway' },
      { code: 503, name: 'Service Unavailable' },
      { code: 429, name: 'Rate Limited' },
    ];

    for (const { code, name } of errorCodes) {
      it(`gracefully isolates failure when a single endpoint returns ${code} (${name})`, async () => {
        mockClient.get = vi.fn().mockImplementation((path: string) => {
          if (path.includes('/content/toc')) {
            const err: any = new Error(`${name} (${code})`);
            err.status = code;
            err.statusCode = code;
            return Promise.reject(err);
          }
          if (path.includes('/overview')) return Promise.resolve({ Title: 'Overview OK' });
          if (path.includes('/news/')) return Promise.resolve([{ Id: 1, Title: 'News OK' }]);
          return Promise.resolve([]);
        });

        const result = await collectCourseData('10001', {
          valenceClient: mockClient,
          skipDom: true,
        });

        expect(result.orgUnitId).toBe('10001');
        expect(result.toc).toBeUndefined();
        expect(result.errors).toBeDefined();
        expect(result.errors?.toc).toContain(String(code));
        // Other endpoints must still succeed
        expect(result.overview?.title).toBe('Overview OK');
        expect(result.announcements).toHaveLength(1);
      });
    }

    it('gracefully handles simultaneous different HTTP errors across all endpoints', async () => {
      mockClient.get = vi.fn().mockImplementation((path: string) => {
        if (path.includes('/overview')) return Promise.reject(new Error('HTTP 401 Unauthorized'));
        if (path.includes('/content/toc')) return Promise.reject(new Error('HTTP 403 Forbidden'));
        if (path.includes('/news/')) return Promise.reject(new Error('HTTP 404 Not Found'));
        if (path.includes('/dropbox/folders/')) return Promise.reject(new Error('HTTP 500 Internal Error'));
        if (path.includes('/quizzes/')) return Promise.reject(new Error('HTTP 502 Bad Gateway'));
        if (path.includes('/calendar/events/')) return Promise.reject(new Error('HTTP 503 Service Unavailable'));
        if (path.includes('/grades/values/myGradeValues/')) return Promise.reject(new Error('HTTP 429 Rate Limit'));
        return Promise.resolve([]);
      });

      const result = await collectCourseData('10002', {
        valenceClient: mockClient,
        skipDom: true,
      });

      expect(result.orgUnitId).toBe('10002');
      expect(result.overview).toBeUndefined();
      expect(result.toc).toBeUndefined();
      expect(result.announcements).toBeUndefined();
      expect(result.assignments).toBeUndefined();
      expect(result.quizzes).toBeUndefined();
      expect(result.calendar).toBeUndefined();
      expect(result.grades).toBeUndefined();
      expect(Object.keys(result.errors || {})).toHaveLength(7);
      expect(result.errors?.overview).toContain('401');
      expect(result.errors?.toc).toContain('403');
      expect(result.errors?.announcements).toContain('404');
      expect(result.errors?.assignments).toContain('500');
      expect(result.errors?.quizzes).toContain('502');
      expect(result.errors?.calendar).toContain('503');
      expect(result.errors?.grades).toContain('429');
    });

    it('handles delayed network timeouts without crashing orchestrator', async () => {
      mockClient.get = vi.fn().mockImplementation((path: string) => {
        if (path.includes('/quizzes/')) {
          return new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Gateway Timeout (504)')), 50)
          );
        }
        if (path.includes('/overview')) {
          return new Promise((resolve) =>
            setTimeout(() => resolve({ Title: 'Slow Overview' }), 30)
          );
        }
        return Promise.resolve([]);
      });

      const result = await collectCourseData('10003', {
        valenceClient: mockClient,
        skipDom: true,
      });

      expect(result.overview?.title).toBe('Slow Overview');
      expect(result.quizzes).toBeUndefined();
      expect(result.errors?.quizzes).toContain('504');
    });

    it('survives version discovery rejection combined with multiple endpoint errors', async () => {
      mockClient.getVersions = vi.fn().mockRejectedValue(new Error('Failed to fetch versions'));
      mockClient.get = vi.fn().mockImplementation((path: string) => {
        if (path.includes('/overview')) return Promise.resolve({ Title: 'Fallback Le Overview' });
        return Promise.reject(new Error('Simulated down'));
      });

      const result = await collectCourseData('10004', {
        valenceClient: mockClient,
        skipDom: true,
      });

      expect(result.errors?.versions).toContain('Version discovery failed');
      expect(result.overview?.title).toBe('Fallback Le Overview');
      expect(result.errors?.toc).toBeDefined();
    });
  });

  // =========================================================================
  // SUITE 2: Malformed Payloads & Unexpected JSON Types
  // =========================================================================
  describe('2. Malformed Responses & Type Edge Cases', () => {
    it('handles endpoints returning null, primitives, or HTML redirect pages instead of expected JSON objects', async () => {
      mockClient.get = vi.fn().mockImplementation((path: string) => {
        if (path.includes('/overview')) return Promise.resolve(null);
        if (path.includes('/content/toc')) return Promise.resolve('<html><head><title>SSO Redirect</title></head><body>Login</body></html>');
        if (path.includes('/news/')) return Promise.resolve(42);
        if (path.includes('/dropbox/folders/')) return Promise.resolve(true);
        if (path.includes('/quizzes/')) return Promise.resolve('plain text error');
        if (path.includes('/calendar/events/')) return Promise.resolve(null);
        if (path.includes('/grades/values/myGradeValues/')) return Promise.resolve(undefined);
        return Promise.resolve([]);
      });

      const result = await collectCourseData('10005', {
        valenceClient: mockClient,
        skipDom: true,
      });

      expect(result.overview).toEqual({ title: 'Course Overview', htmlContent: '', textDescription: '' });
      expect(result.toc).toEqual([]);
      expect(result.announcements).toEqual([]);
      expect(result.assignments).toEqual([]);
      expect(result.quizzes).toEqual([]);
      expect(result.calendar).toEqual([]);
      expect(result.grades).toEqual([]);
    });

    it('survives when items arrays contain null or undefined elements', async () => {
      mockClient.get = vi.fn().mockImplementation((path: string) => {
        if (path.includes('/news/')) return Promise.resolve([null, { Id: 10, Title: 'Valid News' }, undefined]);
        if (path.includes('/dropbox/folders/')) return Promise.resolve([null, { Id: 20, Name: 'Valid Dropbox' }]);
        if (path.includes('/quizzes/')) return Promise.resolve([null, { QuizId: 30, Name: 'Valid Quiz' }]);
        if (path.includes('/calendar/events/')) return Promise.resolve([null, { CalendarEventId: 40, Title: 'Valid Event' }]);
        if (path.includes('/grades/values/myGradeValues/')) return Promise.resolve([null, { GradeObjectIdentifier: '50', GradeObjectName: 'Valid Grade' }]);
        return Promise.resolve([]);
      });

      const result = await collectCourseData('10006', {
        valenceClient: mockClient,
        skipDom: true,
      });

      // When items contain null, individual collector will reject inside Promise.allSettled and log error
      // The orchestrator must not crash!
      expect(result.orgUnitId).toBe('10006');
    });

    it('tests detectTopicType with unusual and edge-case topic inputs', () => {
      // Missing Url and Title
      expect(detectTopicType({})).toEqual({ type: 'unknown' });
      // Case insensitive extension
      expect(detectTopicType({ Url: 'TEST.PDF' })).toEqual({ type: 'file', fileExtension: 'pdf' });
      expect(detectTopicType({ Title: 'LECTURE.PPTX' })).toEqual({ type: 'file', fileExtension: 'pptx' });
      expect(detectTopicType({ Title: 'ASSIGNMENT.DOCX' })).toEqual({ type: 'file', fileExtension: 'docx' });
      expect(detectTopicType({ Url: 'INDEX.HTML' })).toEqual({ type: 'html', fileExtension: 'html' });
      expect(detectTopicType({ TypeIdentifier: 'Link' })).toEqual({ type: 'link' });
      expect(detectTopicType({ Url: 'https://external.brightspace.com/resource' })).toEqual({ type: 'link' });
      expect(detectTopicType({ Url: 'http://insecure.example.com' })).toEqual({ type: 'link' });

      // Non-string types safely handled without throwing
      expect(detectTopicType({ Title: 101 as any })).toEqual({ type: 'unknown' });
    });

    it('tests normalizeTopic with missing/null identifier or download URLs', () => {
      const topic1 = normalizeTopic({ Title: 'File Topic', TypeIdentifier: 'File' }, '12345', '1.74');
      expect(topic1.title).toBe('File Topic');
      expect(topic1.type).toBe('file');
      expect(topic1.topicId).toBe('');

      const topic2 = normalizeTopic({ TopicId: 999, Title: 'PDF Topic', Url: 'file.pdf' }, '12345', '1.74');
      expect(topic2.downloadUrl).toBe('/d2l/api/le/1.74/12345/content/topics/999/file');

      const topic3 = normalizeTopic({ Url: '/custom/path/page.html' }, '12345', '1.74');
      expect(topic3.downloadUrl).toBe('/custom/path/page.html');
    });
  });

  // =========================================================================
  // SUITE 3: Deeply Nested Module Trees & Large TOC Structures
  // =========================================================================
  describe('3. Deeply Nested & High-Volume TOC Structures', () => {
    it('normalizes a deeply nested module hierarchy (50 levels deep)', () => {
      let currentModule: any = {
        ModuleId: 50,
        Title: 'Deepest Module 50',
        Modules: [],
        Topics: [{ TopicId: 501, Title: 'Deep Topic.pdf', Url: 'deep.pdf' }],
      };

      for (let level = 49; level >= 1; level--) {
        currentModule = {
          ModuleId: level,
          Title: `Module Level ${level}`,
          Modules: [currentModule],
          Topics: [{ TopicId: level * 10, Title: `Topic Level ${level}.html`, Url: `level${level}.html` }],
        };
      }

      const normalized = normalizeModule(currentModule, '99999', '1.74');
      expect(normalized.moduleId).toBe('1');
      expect(normalized.title).toBe('Module Level 1');

      // Traverse down 50 levels
      let cursor = normalized;
      let depth = 1;
      while (cursor.subModules && cursor.subModules.length > 0) {
        cursor = cursor.subModules[0];
        depth++;
      }
      expect(depth).toBe(50);
      expect(cursor.title).toBe('Deepest Module 50');
      expect(cursor.topics[0].fileExtension).toBe('pdf');
    });

    it('handles wide module trees with 2,000 topics without performance degradation', () => {
      const topics: any[] = [];
      for (let i = 0; i < 2000; i++) {
        topics.push({
          TopicId: i + 1,
          Title: `Topic ${i + 1}.pdf`,
          TypeIdentifier: 'File',
          Url: `/enforced/topics/file_${i + 1}.pdf`,
        });
      }

      const rawModule = {
        ModuleId: 1,
        Title: 'Mega Module',
        Modules: [],
        Topics: topics,
      };

      const start = performance.now();
      const normalized = normalizeModule(rawModule, '88888', '1.74');
      const duration = performance.now() - start;

      expect(normalized.topics).toHaveLength(2000);
      expect(normalized.topics[1999].title).toBe('Topic 2000.pdf');
      expect(normalized.topics[1999].downloadUrl).toBe('/d2l/api/le/1.74/88888/content/topics/2000/file');
      expect(duration).toBeLessThan(500); // Must process 2,000 topics well under 500ms
    });
  });

  // =========================================================================
  // SUITE 4: HTML Stripping & DOM Text Fallback Under Pressure
  // =========================================================================
  describe('4. HTML Sanitization & DOM Fallback Resilience', () => {
    it('sanitizes large HTML chunks with scripts, styles, and special characters', () => {
      const largeHtml = `
        <div>
          <h1>Welcome to Advanced Algorithms</h1>
          <script>for(let i=0; i<1000; i++) console.log("bad");</script>
          <style>.hide { display: none; }</style>
          <p>Text with entities: &amp; &lt; &gt; &quot; &nbsp;</p>
          <p>${'Repeated lecture content. '.repeat(500)}</p>
          <noscript>Please enable javascript</noscript>
        </div>
      `;

      const clean = stripHtml(largeHtml);
      expect(clean).not.toContain('<script>');
      expect(clean).not.toContain('<style>');
      expect(clean).not.toContain('noscript');
      expect(clean).toContain('Welcome to Advanced Algorithms');
      expect(clean).toContain('& < > "');
      expect(clean.length).toBeGreaterThan(1000);
    });

    it('handles null, undefined, empty string, and whitespace-only in stripHtml', () => {
      expect(stripHtml(null)).toBe('');
      expect(stripHtml(undefined)).toBe('');
      expect(stripHtml('')).toBe('');
      expect(stripHtml('     ')).toBe('');
    });

    it('extractDomFallbackText limits output to maxLength on large DOM trees', () => {
      // Create a simulated large DOM
      const container = document.createElement('main');
      container.id = 'content';
      for (let i = 0; i < 500; i++) {
        const p = document.createElement('p');
        p.textContent = `Paragraph ${i}: Understanding Brightspace LMS Architecture and REST Valence APIs.`;
        container.appendChild(p);
      }
      document.body.appendChild(container);

      const textDefault = extractDomFallbackText(1000);
      expect(textDefault.length).toBeLessThanOrEqual(1000);
      expect(textDefault).toContain('Paragraph 0');

      document.body.removeChild(container);
    });

    it('runs 25 concurrent collection tasks simultaneously without race conditions', async () => {
      mockClient.get = vi.fn().mockImplementation((path: string) => {
        const match = path.match(/le\/1\.74\/(\d+)\//);
        const orgId = match ? match[1] : '0';
        if (path.includes('/overview')) return Promise.resolve({ Title: `Overview ${orgId}` });
        if (path.includes('/content/toc')) return Promise.resolve([{ ModuleId: orgId, Title: `Mod ${orgId}` }]);
        if (path.includes('/news/')) return Promise.resolve([{ Id: orgId, Title: `News ${orgId}` }]);
        return Promise.resolve([]);
      });

      const promises = Array.from({ length: 25 }, (_, idx) =>
        collectCourseData(String(50000 + idx), {
          valenceClient: mockClient,
          skipDom: true,
        })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(25);
      for (let i = 0; i < 25; i++) {
        expect(results[i].orgUnitId).toBe(String(50000 + i));
        expect(results[i].overview?.title).toBe(`Overview ${50000 + i}`);
        expect(results[i].toc?.[0]?.title).toBe(`Mod ${50000 + i}`);
        expect(results[i].announcements?.[0]?.title).toBe(`News ${50000 + i}`);
      }
    });
  });
});
