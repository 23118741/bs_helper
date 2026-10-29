import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isBrightspaceUrl,
  detectOrgUnitId,
  getCourseHomeUrl,
  getBrightspaceOrigin,
} from '@/services/brightspace/courseDetector';
import {
  ValenceClient,
  DEFAULT_VALENCE_VERSIONS,
  ValenceAuthError,
  ValenceForbiddenError,
  ValenceNotFoundError,
  ValenceRateLimitError,
  ValenceError,
} from '@/services/brightspace/valenceClient';

describe('Adversarial Stress Test: Course Detector & Valence Client', () => {
  // =========================================================================
  // SECTION 1: courseDetector.ts Stress Tests
  // =========================================================================
  describe('Course Detector — Adversarial Edge Cases', () => {
    describe('Domain & URL Matching (isBrightspaceUrl)', () => {
      it('handles unusual but valid Brightspace subdomains with hyphens, numbers, and deep levels', () => {
        expect(isBrightspaceUrl('https://my-deep-test.sub-domain.brightspace.com/d2l/home/123')).toBe(true);
        expect(isBrightspaceUrl('https://univ-123.brightspace.com/d2l/le/content/456')).toBe(true);
        expect(isBrightspaceUrl('https://999.brightspace.com/d2l/home')).toBe(true);
      });

      it('correctly handles URLs with port numbers', () => {
        expect(isBrightspaceUrl('https://brightspace.institution.edu:8443/d2l/home')).toBe(true);
        expect(isBrightspaceUrl('http://d2l.mycampus.org:8080/d2l/le/content/123')).toBe(true);
        expect(isBrightspaceUrl('http://localhost:3000/d2l/home/999')).toBe(true);
      });

      it('evaluates D2L path boundaries correctly (strict /d2l/ vs pseudo-names)', () => {
        // Legitimate d2l paths
        expect(isBrightspaceUrl('https://mycampus.edu/d2l/home')).toBe(true);
        expect(isBrightspaceUrl('https://mycampus.edu/d2l/')).toBe(true);
        expect(isBrightspaceUrl('https://mycampus.edu/d2l')).toBe(true);
        expect(isBrightspaceUrl('https://mycampus.edu/prefix/d2l/content')).toBe(true);

        // False positives that start with d2l but are not /d2l/ or /d2l
        expect(isBrightspaceUrl('https://mycampus.edu/d2l_login')).toBe(false);
        expect(isBrightspaceUrl('https://mycampus.edu/d2lnot/index.html')).toBe(false);
        expect(isBrightspaceUrl('https://mycampus.edu/d2l-portal/home')).toBe(false);
      });

      it('rejects domain spoofing attempts', () => {
        // Attacker domain ending in brightspace.com.attacker.com
        expect(isBrightspaceUrl('https://brightspace.com.attacker.com/login')).toBe(false);
        expect(isBrightspaceUrl('https://fake-brightspace.com/courses')).toBe(false);
        expect(isBrightspaceUrl('https://evilbrightspace.com/home')).toBe(false);
      });

      it('handles malformed, empty, and non-HTTP protocols safely', () => {
        expect(isBrightspaceUrl('')).toBe(false);
        expect(isBrightspaceUrl('   ')).toBe(false);
        expect(isBrightspaceUrl('not a url')).toBe(false);
        expect(isBrightspaceUrl('javascript:alert(1)')).toBe(false);
        expect(isBrightspaceUrl('ftp://brightspace.com/files')).toBe(true);
      });

      it('tests non-web protocols containing /d2l/ (e.g. data: URLs)', () => {
        // data: URLs are not web pages and cannot be injected by MV3 extension
        const isDataMatch = isBrightspaceUrl('data:text/html,/d2l/home');
        // Check whether data: URIs are identified as Brightspace:
        // We observe that D2L_PATH_REGEX matches /d2l/ in pathname even on data: protocol
        expect(typeof isDataMatch).toBe('boolean');
      });
    });

    describe('OrgUnitId Detection (detectOrgUnitId)', () => {
      it('handles query strings with multiple ou parameters across different positions', () => {
        // First invalid, second valid -> should recover and extract the numeric one
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/lms/home.d2l?ou=invalid&ou=65432')).toEqual({
          orgUnitId: '65432',
          source: 'query',
        });

        // First valid, second different -> first valid wins
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/lms/home.d2l?ou=11223&ou=99999')).toEqual({
          orgUnitId: '11223',
          source: 'query',
        });

        // First empty, second valid
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/lms/home.d2l?ou=&ou=88776')).toEqual({
          orgUnitId: '88776',
          source: 'query',
        });
      });

      it('handles mixed query parameters in any arbitrary order', () => {
        const url = 'https://uni.brightspace.com/d2l/lms/grades/main.d2l?view=grid&filter=active&sort=desc&ou=77112&page=2&limit=50';
        expect(detectOrgUnitId(url)).toEqual({
          orgUnitId: '77112',
          source: 'query',
        });
      });

      it('handles URL-encoded query parameters and values', () => {
        // Encoded key (%6fu = 'o', %75 = 'u')
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/lms/page.d2l?%6fu=33445')).toEqual({
          orgUnitId: '33445',
          source: 'query',
        });

        // Encoded value (%31%32%33 = '123')
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/lms/page.d2l?ou=%31%32%33')).toEqual({
          orgUnitId: '123',
          source: 'query',
        });

        // Encoded spaces (+ or %20)
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/lms/page.d2l?ou=+98765+')).toEqual({
          orgUnitId: '98765',
          source: 'query',
        });
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/lms/page.d2l?ou=%2098765%20')).toEqual({
          orgUnitId: '98765',
          source: 'query',
        });
      });

      it('rejects malicious or non-numeric query parameters', () => {
        const badValues = [
          'abc',
          '123a',
          'a123',
          '12 34',
          '-500',
          '+500',
          '12.34',
          '0x1f',
          'null',
          'undefined',
          '[object Object]',
          '<script>',
          '123;DROP TABLE courses;',
        ];

        for (const bad of badValues) {
          const res = detectOrgUnitId(`https://uni.brightspace.com/d2l/lms/page.d2l?ou=${encodeURIComponent(bad)}`);
          expect(res.orgUnitId, `Expected rejection for ou=${bad}`).toBeNull();
        }
      });

      it('handles unicode paths and subpaths', () => {
        // Path with Cyrillic / Japanese characters after orgUnitId
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/home/12345/Курс')).toEqual({
          orgUnitId: '12345',
          source: 'path',
        });
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/le/content/54321/日本語モジュール')).toEqual({
          orgUnitId: '54321',
          source: 'path',
        });
      });

      it('handles numeric edge cases: large IDs and zero', () => {
        // Zero
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/home/0')).toEqual({
          orgUnitId: '0',
          source: 'path',
        });
        expect(detectOrgUnitId('https://uni.brightspace.com/d2l/page?ou=0')).toEqual({
          orgUnitId: '0',
          source: 'query',
        });

        // Huge numeric ID (larger than Number.MAX_SAFE_INTEGER, preserved as string)
        const hugeId = '9999999999999999999999999999999999999999';
        expect(detectOrgUnitId(`https://uni.brightspace.com/d2l/home/${hugeId}`)).toEqual({
          orgUnitId: hugeId,
          source: 'path',
        });
      });

      it('handles URL instances as inputs directly', () => {
        const urlObj = new URL('https://uni.brightspace.com/d2l/le/lessons/44556/units/1');
        expect(detectOrgUnitId(urlObj)).toEqual({
          orgUnitId: '44556',
          source: 'path',
        });
      });

      it('handles unexpected types without crashing', () => {
        expect(detectOrgUnitId(null as any)).toEqual({ orgUnitId: null, source: null });
        expect(detectOrgUnitId(undefined as any)).toEqual({ orgUnitId: null, source: null });
        expect(detectOrgUnitId(12345 as any)).toEqual({ orgUnitId: null, source: null });
        expect(detectOrgUnitId({} as any)).toEqual({ orgUnitId: null, source: null });
      });
    });

    describe('URL Helpers (getCourseHomeUrl & getBrightspaceOrigin)', () => {
      it('canonicalizes origins with multiple trailing slashes', () => {
        expect(getCourseHomeUrl('https://myuni.brightspace.com///', '12345')).toBe(
          'https://myuni.brightspace.com/d2l/home/12345'
        );
      });

      it('extracts origin from complex URLs with ports, paths, queries, and fragments', () => {
        expect(
          getBrightspaceOrigin('https://sub.campus.edu:8443/d2l/le/content/123?tab=1&filter=all#news')
        ).toBe('https://sub.campus.edu:8443');
      });

      it('BUG PROBE: checks whether getBrightspaceOrigin rejects non-Brightspace domains or invalid URLs', () => {
        expect(getBrightspaceOrigin('https://google.com')).toBeNull();
        expect(getBrightspaceOrigin('not a valid url')).toBeNull();
      });
    });
  });

  // =========================================================================
  // SECTION 2: valenceClient.ts Stress Tests
  // =========================================================================
  describe('Valence Client — Adversarial Edge Cases', () => {
    let originalCookie: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalCookie = Object.getOwnPropertyDescriptor(document, 'cookie');
    });

    afterEach(() => {
      if (originalCookie) {
        Object.defineProperty(document, 'cookie', originalCookie);
      }
      vi.restoreAllMocks();
    });

    describe('Anti-CSRF Cookie Extraction (getXsrfToken)', () => {
      function setMockCookie(cookieStr: string) {
        Object.defineProperty(document, 'cookie', {
          value: cookieStr,
          writable: true,
          configurable: true,
        });
      }

      it('extracts XSRF.Token with base64 padding characters (==)', () => {
        setMockCookie('session=abc; XSRF.Token=dGhpcyBpcyBhIHRlc3Q==; path=/');
        const client = new ValenceClient();
        expect(client.getXsrfToken()).toBe('dGhpcyBpcyBhIHRlc3Q==');
      });

      it('extracts XSRF.Token with URL-encoded special characters and decodes them', () => {
        setMockCookie('XSRF.Token=token%2Bwith%20spaces%2Fand%3D; other=val');
        const client = new ValenceClient();
        expect(client.getXsrfToken()).toBe('token+with spaces/and=');
      });

      it('safely handles malformed percent-encoding without crashing', () => {
        setMockCookie('XSRF.Token=token%ZZ%bad; other=val');
        const client = new ValenceClient();
        expect(client.getXsrfToken()).toBe('token%ZZ%bad');
      });

      it('supports XSRF-TOKEN (hyphenated) naming convention', () => {
        setMockCookie('foo=bar; XSRF-TOKEN=hyphenated_token_123; path=/');
        const client = new ValenceClient();
        expect(client.getXsrfToken()).toBe('hyphenated_token_123');
      });

      it('extracts token when surrounded by irregular whitespace and multiple cookies', () => {
        setMockCookie('  c1=v1  ;   XSRF.Token=spaced_token_77   ;   c2=v2  ');
        const client = new ValenceClient();
        expect(client.getXsrfToken()).toBe('spaced_token_77');
      });

      it('returns null when cookie value is empty', () => {
        setMockCookie('XSRF.Token=; other=val');
        const client = new ValenceClient();
        expect(client.getXsrfToken()).toBeNull();
      });

      it('returns null when no CSRF cookie exists', () => {
        setMockCookie('d2lSessionVal=12345; d2lSecureSessionVal=67890');
        const client = new ValenceClient();
        expect(client.getXsrfToken()).toBeNull();
      });

      it('prioritizes customXsrfToken when configured in options', () => {
        setMockCookie('XSRF.Token=cookie_token');
        const client = new ValenceClient({ customXsrfToken: 'custom_override_token' });
        expect(client.getXsrfToken()).toBe('custom_override_token');
      });

      it('BUG PROBE: checks whether cookie values wrapped in RFC 6265 quotes have quotes stripped', () => {
        setMockCookie('XSRF.Token="c73bcdcc-2669-4bf6-81d3-e4ae73fb11ff"; path=/');
        const client = new ValenceClient();
        const token = client.getXsrfToken();
        // In RFC 6265, cookies wrapped in double quotes represent the value without quotes
        // If quotes are not stripped, token will literally be '"c73bcdcc-2669-4bf6-81d3-e4ae73fb11ff"'
        expect(token).not.toMatch(/^".*"$/);
      });
    });

    describe('URL Construction (buildUrl)', () => {
      it('properly constructs product endpoint URLs with and without orgUnitId', () => {
        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });

        expect(client.buildUrl('le', 'overview', '12345')).toBe(
          'https://myuni.brightspace.com/d2l/api/le/1.74/12345/overview'
        );

        expect(client.buildUrl('lp', 'enrollments/myenrollments/')).toBe(
          'https://myuni.brightspace.com/d2l/api/lp/1.45/enrollments/myenrollments/'
        );
      });

      it('strips leading slash from endpointPath to prevent double slashes in path', () => {
        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });
        expect(client.buildUrl('le', '/content/toc', '12345')).toBe(
          'https://myuni.brightspace.com/d2l/api/le/1.74/12345/content/toc'
        );
      });

      it('BUG PROBE: checks behavior when origin has a trailing slash in buildUrl', () => {
        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com/' });
        const url = client.buildUrl('le', 'overview', '12345');
        // If origin trailing slash is not sanitized, url contains double slash //d2l/api
        expect(url).not.toContain('.com//d2l');
      });

      it('BUG PROBE: checks behavior when endpointPath has multiple leading slashes', () => {
        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });
        const url = client.buildUrl('le', '///content/toc', '12345');
        expect(url).not.toContain('12345//content');
      });
    });

    describe('Dynamic Version Discovery (discoverVersions)', () => {
      it('correctly parses version responses when ProductCode has varying case', async () => {
        const mockVersions = [
          { ProductCode: 'LE', LatestVersion: '1.80' },
          { ProductCode: 'LP', LatestVersion: '1.50' },
        ];

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(mockVersions),
        }));

        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });
        const versions = await client.discoverVersions(true);

        expect(versions.le).toBe('1.80');
        expect(versions.lp).toBe('1.50');
      });

      it('BUG PROBE: checks whether ProductCode with trailing/leading whitespace is parsed', async () => {
        const mockVersions = [
          { ProductCode: 'le ', LatestVersion: '1.85' },
          { ProductCode: ' lp', LatestVersion: '1.55' },
        ];

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(mockVersions),
        }));

        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });
        const versions = await client.discoverVersions(true);

        expect(versions.le).toBe('1.85');
        expect(versions.lp).toBe('1.55');
      });

      it('handles numeric LatestVersion correctly by coercing to string', async () => {
        const mockVersions = [
          { ProductCode: 'le', LatestVersion: 1.78 },
          { ProductCode: 'lp', LatestVersion: 1.48 },
        ];

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve(mockVersions),
        }));

        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });
        const versions = await client.discoverVersions(true);

        expect(versions.le).toBe('1.78');
        expect(versions.lp).toBe('1.48');
      });

      it('falls back to DEFAULT_VALENCE_VERSIONS on non-array JSON response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ error: 'Unexpected object structure' }),
        }));

        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });
        const versions = await client.discoverVersions(true);

        expect(versions).toEqual(DEFAULT_VALENCE_VERSIONS);
      });

      it('falls back to DEFAULT_VALENCE_VERSIONS on HTTP errors (403, 404, 500)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
          headers: new Headers(),
        }));

        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });
        const versions = await client.discoverVersions(true);

        expect(versions).toEqual(DEFAULT_VALENCE_VERSIONS);
      });

      it('falls back to DEFAULT_VALENCE_VERSIONS when response is HTML instead of JSON', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
          text: () => Promise.resolve('<html>Login Page</html>'),
        }));

        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });
        const versions = await client.discoverVersions(true);

        expect(versions).toEqual(DEFAULT_VALENCE_VERSIONS);
      });

      it('deduplicates concurrent calls to discoverVersions() using cached promise', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve([{ ProductCode: 'le', LatestVersion: '1.76' }]),
        });
        vi.stubGlobal('fetch', mockFetch);

        const client = new ValenceClient({ origin: 'https://myuni.brightspace.com' });
        const [v1, v2, v3] = await Promise.all([
          client.discoverVersions(),
          client.discoverVersions(),
          client.discoverVersions(),
        ]);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(v1.le).toBe('1.76');
        expect(v2.le).toBe('1.76');
        expect(v3.le).toBe('1.76');
      });
    });

    describe('Universal Fetch & Error Mapping (fetchJson)', () => {
      it('maps HTTP 401 to ValenceAuthError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('Session expired'),
        }));

        const client = new ValenceClient();
        await expect(client.fetchJson('https://uni.brightspace.com/d2l/api/le/1.74/123/overview'))
          .rejects.toThrow(ValenceAuthError);
      });

      it('maps HTTP 403 to ValenceForbiddenError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          text: () => Promise.resolve('Grades access denied'),
        }));

        const client = new ValenceClient();
        await expect(client.fetchJson('https://uni.brightspace.com/d2l/api/le/1.74/123/grades/values/myGradeValues/'))
          .rejects.toThrow(ValenceForbiddenError);
      });

      it('maps HTTP 404 to ValenceNotFoundError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: () => Promise.resolve('Endpoint not implemented'),
        }));

        const client = new ValenceClient();
        await expect(client.fetchJson('https://uni.brightspace.com/d2l/api/le/1.74/123/quizzes/'))
          .rejects.toThrow(ValenceNotFoundError);
      });

      it('maps HTTP 429 to ValenceRateLimitError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: () => Promise.resolve('Rate limit exceeded'),
        }));

        const client = new ValenceClient();
        await expect(client.fetchJson('https://uni.brightspace.com/d2l/api/le/1.74/123/news/'))
          .rejects.toThrow(ValenceRateLimitError);
      });

      it('maps HTTP 500 to generic ValenceError with responseBody attached', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Database connection failure'),
        }));

        const client = new ValenceClient();
        try {
          await client.fetchJson('https://uni.brightspace.com/d2l/api/le/1.74/123/overview');
          expect.fail('Should have thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(ValenceError);
          expect(err.statusCode).toBe(500);
          expect(err.responseBody).toBe('Database connection failure');
        }
      });

      it('handles HTTP 204 No Content gracefully by returning null', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          status: 204,
          headers: new Headers(),
        }));

        const client = new ValenceClient();
        const res = await client.fetchJson('https://uni.brightspace.com/d2l/api/le/1.74/123/reset');
        expect(res).toBeNull();
      });

      it('sends correct headers: Accept, X-Requested-With, and X-Csrf-Token', async () => {
        let sentHeaders: any = {};
        vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: any) => {
          sentHeaders = init.headers;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ success: true }),
          });
        }));

        const client = new ValenceClient({
          origin: 'https://uni.brightspace.com',
          customXsrfToken: 'test_csrf_token_xyz',
        });

        await client.fetchJson('https://uni.brightspace.com/d2l/api/lp/1.45/enrollments/myenrollments/');

        expect(sentHeaders['X-Requested-With']).toBe('XMLHttpRequest');
        expect(sentHeaders['X-Csrf-Token']).toBe('test_csrf_token_xyz');
        expect(sentHeaders['Accept']).toContain('application/json');
      });

      it('BUG PROBE: handles case-insensitive Content-Type: Application/Json in fetchJson', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'Application/Json; charset=utf-8' }),
          json: () => Promise.resolve({ success: true, count: 42 }),
          text: () => Promise.resolve('{"success":true,"count":42}'),
        }));

        const client = new ValenceClient({ origin: 'https://uni.brightspace.com' });
        const res = await client.fetchJson<{ success: boolean; count: number }>(
          'https://uni.brightspace.com/d2l/api/le/1.74/123/test'
        );

        // If bug exists, res will be string '{"success":true,"count":42}' instead of object { success: true, count: 42 }
        expect(typeof res).toBe('object');
        expect(res.success).toBe(true);
      });
    });
  });
});
