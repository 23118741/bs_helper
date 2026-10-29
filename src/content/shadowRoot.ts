/**
 * src/content/shadowRoot.ts
 * Manages Shadow DOM isolation container, host element lifecycle,
 * and scoped Tailwind CSS stylesheet injection for BS Helper.
 */

import styles from './styles.css?inline';

export const SHADOW_HOST_ID = 'brightspace-ai-helper-host';
export const SHADOW_ROOT_APP_ID = 'brightspace-ai-helper-root';
export const SHADOW_STYLE_ID = 'brightspace-ai-styles';

export interface ShadowContainerResult {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  appContainer: HTMLElement;
  isExisting: boolean;
}

/**
 * Creates and attaches an open Shadow DOM container to document.body
 * with completely encapsulated styles and a dedicated React mount point.
 * Idempotent: returns existing container if already mounted.
 */
export function createShadowRootContainer(): ShadowContainerResult {
  const existingHost = document.getElementById(SHADOW_HOST_ID);
  if (existingHost && existingHost.shadowRoot) {
    const existingApp =
      existingHost.shadowRoot.getElementById(SHADOW_ROOT_APP_ID) ||
      existingHost.shadowRoot.getElementById('brightspace-ai-app-root');
    if (existingApp) {
      return {
        host: existingHost,
        shadowRoot: existingHost.shadowRoot,
        appContainer: existingApp,
        isExisting: true,
      };
    }
  }

  // 1. Create Host Element
  const host = document.createElement('div');
  host.id = SHADOW_HOST_ID;
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    overflow: 'visible',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });

  // 2. Attach Open Shadow Root
  const shadowRoot = host.attachShadow({ mode: 'open' });

  // 3. Inject Compiled Tailwind Stylesheet
  const styleEl = document.createElement('style');
  styleEl.id = SHADOW_STYLE_ID;
  styleEl.textContent = styles;
  shadowRoot.appendChild(styleEl);

  // 4. Create React Mount Container
  const appContainer = document.createElement('div');
  appContainer.id = SHADOW_ROOT_APP_ID;
  appContainer.className = 'brightspace-ai-root brightspace-ai-app-root font-sans antialiased text-slate-900';
  appContainer.style.pointerEvents = 'auto';
  shadowRoot.appendChild(appContainer);

  // 5. Append Host to Document
  const targetParent = document.body || document.documentElement;
  targetParent.appendChild(host);

  return {
    host,
    shadowRoot,
    appContainer,
    isExisting: false,
  };
}

/**
 * Removes the Shadow DOM host element and cleans up.
 */
export function removeShadowRootContainer(): boolean {
  const host = document.getElementById(SHADOW_HOST_ID);
  if (host && host.parentNode) {
    host.parentNode.removeChild(host);
    return true;
  }
  return false;
}

/**
 * Returns the active ShadowRoot if mounted, null otherwise.
 */
export function getActiveShadowRoot(): ShadowRoot | null {
  const host = document.getElementById(SHADOW_HOST_ID);
  return host?.shadowRoot || null;
}
