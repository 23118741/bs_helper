import { OrgUnitDetection } from '@/types/brightspace';

// Brightspace Domain Patterns:
// Matches *.brightspace.com or any hostname when path contains /d2l/
export const BRIGHTSPACE_DOMAIN_REGEX = /^(?:[a-z0-9-]+\.)*brightspace\.com$/i;
export const D2L_PATH_REGEX = /\/d2l(?:\/|$)/i;

// Localhost / Mock Environment Detection:
export const LOCAL_MOCK_HOST_REGEX = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;
export const MOCK_PAGE_PATH_REGEX = /mock-brightspace\.html/i;

// OrgUnitId Path Patterns (Strict Numeric \d+):
// 1. Course Home: /d2l/home/12345
export const PATH_HOME_REGEX = /\/d2l\/home\/(\d+)(?:[/?#]|$)/i;

// 2. Content & TOC: /d2l/le/content/12345/...
export const PATH_CONTENT_REGEX = /\/d2l\/le\/content\/(\d+)(?:[/?#]|$)/i;

// 3. New Learner Experience Lessons: /d2l/le/lessons/12345/...
export const PATH_LESSONS_REGEX = /\/d2l\/le\/lessons\/(\d+)(?:[/?#]|$)/i;

// 4. Other LE Tools: /d2l/le/{tool}/12345 (e.g. /d2l/le/calendar/12345, /d2l/le/dropbox/12345)
export const PATH_LE_TOOL_REGEX = /\/d2l\/le\/[a-zA-Z0-9_-]+\/(\d+)(?:[/?#]|$)/i;

/**
 * Checks if a given URL belongs to a D2L Brightspace instance or mock environment.
 */
export function isBrightspaceUrl(inputUrl: string | URL): boolean {
  try {
    if (!inputUrl) return false;
    const url = typeof inputUrl === 'string' ? new URL(inputUrl, 'http://localhost') : inputUrl;
    
    // File protocol check for local mock testing
    if (url.protocol === 'file:') {
      return MOCK_PAGE_PATH_REGEX.test(url.pathname);
    }

    const hostname = url.hostname;
    const pathname = url.pathname;

    // 1. Matches *.brightspace.com
    if (BRIGHTSPACE_DOMAIN_REGEX.test(hostname)) {
      return true;
    }

    // 2. Matches any host with /d2l/ in path
    if (D2L_PATH_REGEX.test(pathname)) {
      return true;
    }

    // 3. Matches local dev mock page
    if (LOCAL_MOCK_HOST_REGEX.test(url.host) && (MOCK_PAGE_PATH_REGEX.test(pathname) || D2L_PATH_REGEX.test(pathname))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Extracts active course orgUnitId and its detection source from a URL.
 */
export function detectOrgUnitId(inputUrl: string | URL): OrgUnitDetection {
  try {
    if (!inputUrl) return { orgUnitId: null, source: null };
    // Support relative or absolute URLs
    const base = 'http://localhost';
    const url = typeof inputUrl === 'string' ? new URL(inputUrl, base) : inputUrl;
    const pathname = url.pathname;

    // Step 1: Check Path Patterns (Highest Priority for active resource view)
    const homeMatch = pathname.match(PATH_HOME_REGEX);
    if (homeMatch && homeMatch[1]) {
      return { orgUnitId: homeMatch[1], source: 'path' };
    }

    const contentMatch = pathname.match(PATH_CONTENT_REGEX);
    if (contentMatch && contentMatch[1]) {
      return { orgUnitId: contentMatch[1], source: 'path' };
    }

    const lessonsMatch = pathname.match(PATH_LESSONS_REGEX);
    if (lessonsMatch && lessonsMatch[1]) {
      return { orgUnitId: lessonsMatch[1], source: 'path' };
    }

    const leToolMatch = pathname.match(PATH_LE_TOOL_REGEX);
    if (leToolMatch && leToolMatch[1]) {
      return { orgUnitId: leToolMatch[1], source: 'path' };
    }

    // Step 2: Check Query Parameters (ou / OU parameter)
    // Works for /d2l/lms/dropbox/user/folders_list.d2l?ou=12345, /d2l/lms/grades/..., etc.
    for (const [key, val] of url.searchParams.entries()) {
      if (key.toLowerCase() === 'ou') {
        const trimmed = val.trim();
        if (/^\d+$/.test(trimmed)) {
          return { orgUnitId: trimmed, source: 'query' };
        }
      }
    }

    return { orgUnitId: null, source: null };
  } catch {
    return { orgUnitId: null, source: null };
  }
}

/**
 * Builds the canonical Brightspace course homepage URL.
 */
export function getCourseHomeUrl(origin: string, orgUnitId: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  return `${cleanOrigin}/d2l/home/${orgUnitId}`;
}

/**
 * Extracts the Brightspace origin (protocol + host) from any Brightspace URL.
 * Validates that the URL belongs to a Brightspace instance or mock page before returning origin.
 * Returns null if the URL is not a valid Brightspace URL or cannot be parsed.
 */
export function getBrightspaceOrigin(inputUrl: string): string | null {
  try {
    if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) return null;
    const trimmed = inputUrl.trim();
    if (!isBrightspaceUrl(trimmed)) return null;

    const base = typeof window !== 'undefined' && window?.location?.origin ? window.location.origin : 'http://localhost';
    const url = new URL(trimmed, base);
    return url.origin && url.origin !== 'null' ? url.origin : null;
  } catch {
    return null;
  }
}
