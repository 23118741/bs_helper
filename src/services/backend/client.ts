/**
 * src/services/backend/client.ts
 * Content-script side of the API: sends messages to the service worker (see apiProxy.ts).
 */

import type { ApiErrorCode } from '../../../shared/contract';
import {
  API_MESSAGE_TYPE,
  GENERATE_PORT_NAME,
  type ApiOp,
  type ApiRequestMessage,
  type ApiResponseMessage,
} from './messages';

export class BackendError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status = 0,
    readonly retryAfter?: number
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

export type Transport = (msg: ApiRequestMessage, signal?: AbortSignal) => Promise<ApiResponseMessage>;

const chromeRuntime = (): typeof chrome.runtime | undefined =>
  typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime : undefined;

/** Default transport: chrome.runtime messaging. `generate` uses a port so Stop can cancel the call. */
const defaultTransport: Transport = async (msg, signal) => {
  const rt = chromeRuntime();
  if (!rt) throw new BackendError('NETWORK', 'The extension is not reachable. Reload the page.');

  if (msg.op === 'generate' && signal && rt.connect) {
    return new Promise<ApiResponseMessage>((resolve, reject) => {
      const port = rt.connect({ name: GENERATE_PORT_NAME });
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () =>
        done(() => {
          port.disconnect(); // the service worker aborts the fetch → the server aborts the AI call
          reject(new DOMException('Aborted', 'AbortError'));
        });
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort);
      port.onMessage.addListener((resp: ApiResponseMessage) => done(() => (port.disconnect(), resolve(resp))));
      port.onDisconnect.addListener(() => done(() => reject(new BackendError('NETWORK', 'Connection to the extension was lost. Reload the page.'))));
      port.postMessage(msg);
    });
  }

  try {
    return (await rt.sendMessage(msg)) as ApiResponseMessage;
  } catch {
    throw new BackendError('NETWORK', 'The extension is not reachable. Reload the page.');
  }
};

let transport: Transport = defaultTransport;

/** Tests (and the mock page) can replace the transport. */
export function setTransport(t: Transport | null): void {
  transport = t ?? defaultTransport;
}

export async function callApi<T = unknown>(op: ApiOp, body?: unknown, signal?: AbortSignal): Promise<T> {
  const resp = await transport({ type: API_MESSAGE_TYPE, op, body }, signal);
  if (!resp || typeof resp !== 'object') throw new BackendError('NETWORK', 'Invalid response from the extension.');
  if (!resp.ok) {
    const e = resp.error;
    throw new BackendError(e?.code ?? 'INTERNAL', e?.message ?? 'Unknown error.', resp.status, e?.retry_after);
  }
  return resp.data as T;
}
