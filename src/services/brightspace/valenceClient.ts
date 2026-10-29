import { D2LVersionMap } from '@/types/brightspace';

export interface ValenceClientOptions {
  origin?: string;
  defaultVersions?: D2LVersionMap;
  customXsrfToken?: string;
}

export class ValenceError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
    public readonly responseBody?: string
  ) {
    super(message);
    this.name = 'ValenceError';
  }
}

export class ValenceAuthError extends ValenceError {
  constructor(message = 'Brightspace session unauthenticated or expired.', endpoint?: string) {
    super(message, 401, endpoint);
    this.name = 'ValenceAuthError';
  }
}

export class ValenceForbiddenError extends ValenceError {
  constructor(message = 'Access to this Brightspace resource is restricted.', endpoint?: string) {
    super(message, 403, endpoint);
    this.name = 'ValenceForbiddenError';
  }
}

export class ValenceNotFoundError extends ValenceError {
  constructor(message = 'Brightspace resource not found.', endpoint?: string) {
    super(message, 404, endpoint);
    this.name = 'ValenceNotFoundError';
  }
}

export class ValenceRateLimitError extends ValenceError {
  constructor(message = 'Brightspace API rate limit reached.', endpoint?: string) {
    super(message, 429, endpoint);
    this.name = 'ValenceRateLimitError';
  }
}

export const DEFAULT_VALENCE_VERSIONS: D2LVersionMap = {
  le: '1.74',
  lp: '1.45',
};

export class ValenceClient {
  private origin: string;
  private versions: D2LVersionMap;
  private versionDiscoveryPromise: Promise<D2LVersionMap> | null = null;
  private customXsrfToken?: string;

  constructor(options?: ValenceClientOptions) {
    const rawOrigin = options?.origin || (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
    this.origin = rawOrigin.trim().replace(/\/+$/, '');
    this.versions = options?.defaultVersions ? { ...options.defaultVersions } : { ...DEFAULT_VALENCE_VERSIONS };
    this.customXsrfToken = options?.customXsrfToken;
  }

  /**
   * Reads anti-CSRF token from document.cookie (named 'XSRF.Token').
   */
  public getXsrfToken(): string | null {
    if (this.customXsrfToken) {
      return this.customXsrfToken;
    }

    if (typeof document === 'undefined') {
      return null;
    }

    const cookies = document.cookie || '';
    // Match XSRF.Token=... or XSRF-TOKEN=...
    const match = cookies.match(/(?:^|;\s*)XSRF\.Token=([^;]+)/i) || cookies.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/i);
    if (match && match[1]) {
      // RFC 6265 permits cookie values enclosed in double quotes; strip them before & after decoding
      let val = match[1].trim().replace(/^"(.*)"$/, '$1').trim();
      try {
        val = decodeURIComponent(val).trim().replace(/^"(.*)"$/, '$1').trim();
      } catch {
        // Fallback to un-decoded string if malformed percent-encoding
      }
      return val.length > 0 ? val : null;
    }
    return null;
  }

  /**
   * Dynamically discovers supported versions via GET /d2l/api/versions/
   * Falls back to DEFAULT_VALENCE_VERSIONS on error.
   */
  public async discoverVersions(forceRefresh = false): Promise<D2LVersionMap> {
    if (!forceRefresh && this.versionDiscoveryPromise) {
      return this.versionDiscoveryPromise;
    }

    this.versionDiscoveryPromise = (async () => {
      try {
        const url = `${this.origin}/d2l/api/versions/`;
        const headers: Record<string, string> = {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        };

        const xsrf = this.getXsrfToken();
        if (xsrf) {
          headers['X-Csrf-Token'] = xsrf;
        }

        const response = await fetch(url, {
          method: 'GET',
          headers,
          credentials: 'include',
        });

        if (!response.ok) {
          console.warn(`[ValenceClient] /d2l/api/versions/ returned ${response.status}. Using defaults.`);
          return { ...DEFAULT_VALENCE_VERSIONS };
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) {
          console.warn('[ValenceClient] /d2l/api/versions/ did not return JSON. Using defaults.');
          return { ...DEFAULT_VALENCE_VERSIONS };
        }

        const data = await response.json();
        const discovered = { ...DEFAULT_VALENCE_VERSIONS };

        if (Array.isArray(data)) {
          for (const item of data) {
            if (!item || typeof item !== 'object') continue;
            const code = String(item.ProductCode || '').trim().toLowerCase();
            const latest = item.LatestVersion;
            if (code === 'le' && latest !== undefined && latest !== null) {
              discovered.le = String(latest).trim();
            } else if (code === 'lp' && latest !== undefined && latest !== null) {
              discovered.lp = String(latest).trim();
            }
          }
        }

        this.versions = discovered;
        return discovered;
      } catch (err) {
        console.warn('[ValenceClient] Failed to discover versions. Using defaults:', err);
        return { ...DEFAULT_VALENCE_VERSIONS };
      }
    })();

    return this.versionDiscoveryPromise;
  }

  /**
   * Returns discovered or cached versions.
   */
  public async getVersions(): Promise<D2LVersionMap> {
    return this.discoverVersions();
  }

  /**
   * Synchronous accessor for currently cached versions.
   */
  public get cachedVersions(): D2LVersionMap {
    return { ...this.versions };
  }

  /**
   * Manually sets versions (useful for testing).
   */
  public setVersions(versions: Partial<D2LVersionMap>): void {
    this.versions = { ...this.versions, ...versions };
    this.versionDiscoveryPromise = Promise.resolve({ ...this.versions });
  }

  /**
   * Builds full Valence API path for product endpoint.
   */
  public buildUrl(product: 'le' | 'lp', endpointPath: string, orgUnitId?: string): string {
    const version = this.versions[product];
    const cleanPath = endpointPath.replace(/^\/+/, '');
    
    if (orgUnitId) {
      return `${this.origin}/d2l/api/${product}/${version}/${orgUnitId}/${cleanPath}`;
    }
    return `${this.origin}/d2l/api/${product}/${version}/${cleanPath}`;
  }

  /**
   * Universal fetch helper handling session cookies, CSRF token, and status code mapping.
   */
  public async fetchJson<T>(fullUrl: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      ...(init?.headers as Record<string, string> || {}),
    };

    const xsrf = this.getXsrfToken();
    if (xsrf) {
      headers['X-Csrf-Token'] = xsrf;
    }

    const response = await fetch(fullUrl, {
      ...init,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }

      if (response.status === 401) {
        throw new ValenceAuthError(`Session unauthenticated or expired at ${fullUrl}`, fullUrl);
      }
      if (response.status === 403) {
        throw new ValenceForbiddenError(`Forbidden (403) at ${fullUrl}`, fullUrl);
      }
      if (response.status === 404) {
        throw new ValenceNotFoundError(`Not found (404) at ${fullUrl}`, fullUrl);
      }
      if (response.status === 429) {
        throw new ValenceRateLimitError(`Rate limited (429) at ${fullUrl}`, fullUrl);
      }

      throw new ValenceError(
        `Brightspace API request failed: ${response.status} ${response.statusText}`,
        response.status,
        fullUrl,
        errorBody
      );
    }

    if (response.status === 204) {
      return null as unknown as T;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    if (contentType.includes('text/html')) {
      throw new ValenceAuthError(
        `Received HTML response from API endpoint at ${fullUrl}. Session may be expired or redirected to SSO login.`,
        fullUrl
      );
    }

    // Fallback if returned plain text or other non-HTML format
    const textData = await response.text();
    const trimmed = textData.trim();
    if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html') || trimmed.toLowerCase().includes('id="login"')) {
      throw new ValenceAuthError(
        `Received HTML content from API endpoint at ${fullUrl}. Session may be expired or redirected to SSO login.`,
        fullUrl
      );
    }
    return textData as unknown as T;
  }

  /**
   * Downloads a binary resource (PDF, PPTX, ...) with the user's session cookies.
   */
  public async getBinary(
    path: string,
    signal?: AbortSignal,
    allowHtml = false
  ): Promise<{ data: ArrayBuffer; contentType: string; filename?: string }> {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = path.startsWith('http') ? path : `${this.origin}${cleanPath}`;
    const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
    const xsrf = this.getXsrfToken();
    if (xsrf) headers['X-Csrf-Token'] = xsrf;

    const response = await fetch(url, { method: 'GET', headers, credentials: 'include', signal });
    if (!response.ok) {
      if (response.status === 401) throw new ValenceAuthError(`Session expired at ${url}`, url);
      if (response.status === 403) throw new ValenceForbiddenError(`Forbidden (403) at ${url}`, url);
      if (response.status === 404) throw new ValenceNotFoundError(`Not found (404) at ${url}`, url);
      throw new ValenceError(`Download failed: ${response.status} ${response.statusText}`, response.status, url);
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      // HTML course pages are legitimate downloads; only reject if we were bounced to a login page.
      const bounced = response.redirected && /login|saml|sso|adfs|oauth|auth/i.test(response.url);
      if (!allowHtml || bounced) {
        throw new ValenceAuthError(`Got an HTML page instead of a file at ${url} (login redirect?)`, url);
      }
    }
    const disposition = response.headers.get('content-disposition') || '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    let filename: string | undefined;
    if (match) {
      try {
        filename = decodeURIComponent(match[1]);
      } catch {
        filename = match[1];
      }
    }
    return { data: await response.arrayBuffer(), contentType, filename };
  }

  /**
   * General HTTP GET helper for arbitrary endpoints.
   */
  public async get<T>(path: string): Promise<T> {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = path.startsWith('http') ? path : `${this.origin}${cleanPath}`;
    return this.fetchJson<T>(url, { method: 'GET' });
  }

  // ==========================================
  // Typed High-Level Endpoint Fetchers
  // ==========================================

  public async getMyEnrollments(): Promise<any[]> {
    const url = this.buildUrl('lp', 'enrollments/myenrollments/');
    return this.fetchJson<any[]>(url);
  }

  public async getCourseOverview(orgUnitId: string): Promise<any> {
    const url = this.buildUrl('le', 'overview', orgUnitId);
    return this.fetchJson<any>(url);
  }

  public async getTableOfContents(orgUnitId: string): Promise<any> {
    const url = this.buildUrl('le', 'content/toc', orgUnitId);
    return this.fetchJson<any>(url);
  }

  public async getNews(orgUnitId: string): Promise<any[]> {
    const url = this.buildUrl('le', 'news/', orgUnitId);
    return this.fetchJson<any[]>(url);
  }

  public async getDropboxFolders(orgUnitId: string): Promise<any[]> {
    const url = this.buildUrl('le', 'dropbox/folders/', orgUnitId);
    return this.fetchJson<any[]>(url);
  }

  public async getQuizzes(orgUnitId: string): Promise<any[]> {
    const url = this.buildUrl('le', 'quizzes/', orgUnitId);
    return this.fetchJson<any[]>(url);
  }

  public async getCalendarEvents(orgUnitId: string): Promise<any[]> {
    const url = this.buildUrl('le', 'calendar/events/', orgUnitId);
    return this.fetchJson<any[]>(url);
  }

  public async getMyGradeValues(orgUnitId: string): Promise<any[]> {
    const url = this.buildUrl('le', 'grades/values/myGradeValues/', orgUnitId);
    return this.fetchJson<any[]>(url);
  }
}
