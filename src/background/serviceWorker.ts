import { createChromeTokenStorage, handleApiMessage, type ProxyDeps } from '@/services/backend/apiProxy';
import { API_BASE_URL } from '@/services/backend/env';
import {
  API_MESSAGE_TYPE,
  GENERATE_PORT_NAME,
  type ApiRequestMessage,
} from '@/services/backend/messages';

console.log('[BS Helper] Background service worker initialized');

if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DRAWER' });
    } catch (err) {
      console.warn('[BS Helper] Could not send TOGGLE_DRAWER to tab (refresh the Brightspace tab if the extension was just installed):', err);
    }
  });
}

// ---- Backend API proxy: the only place that holds the session token and talks to the server ----

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  // Earlier versions locked chrome.storage.local to extension pages, and Chrome remembers that
  // setting. The content script keeps its settings there, so open it up again explicitly.
  try {
    void chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  } catch {
    // browsers without setAccessLevel never restricted it
  }

  const deps = (): ProxyDeps => ({
    baseUrl: API_BASE_URL,
    clientVersion: chrome.runtime.getManifest().version,
    fetchImpl: fetch.bind(globalThis),
    storage: createChromeTokenStorage(),
  });

  chrome.runtime.onMessage.addListener((msg: ApiRequestMessage, sender, sendResponse) => {
    // Only our own content scripts / pages may use the proxy.
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== API_MESSAGE_TYPE) return false;
    handleApiMessage(msg, deps()).then(sendResponse);
    return true; // async response
  });

  // Streaming-free "generate" over a port so that closing the port (Stop button) aborts the request.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== GENERATE_PORT_NAME || port.sender?.id !== chrome.runtime.id) return;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener(async (msg: ApiRequestMessage) => {
      if (!msg || msg.type !== API_MESSAGE_TYPE) return;
      const resp = await handleApiMessage(msg, deps(), controller.signal);
      if (!controller.signal.aborted) port.postMessage(resp);
    });
  });
}
