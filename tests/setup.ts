import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { vi, beforeEach } from 'vitest';
import { resetChatSessions } from '@/services/chat/chatSessions';

// In-memory Chrome storage mock
const storageStore: Record<string, any> = {};

(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[] | Record<string, any> | null) => {
        if (!keys) return { ...storageStore };
        if (typeof keys === 'string') return { [keys]: storageStore[keys] };
        if (Array.isArray(keys)) {
          const result: Record<string, any> = {};
          for (const k of keys) {
            if (k in storageStore) result[k] = storageStore[k];
          }
          return result;
        }
        if (typeof keys === 'object') {
          const result: Record<string, any> = { ...keys };
          for (const k of Object.keys(keys)) {
            if (k in storageStore) result[k] = storageStore[k];
          }
          return result;
        }
        return { ...storageStore };
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(storageStore, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete storageStore[k];
      }),
      clear: vi.fn(async () => {
        for (const k in storageStore) delete storageStore[k];
      }),
    },
    sync: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    },
  },
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://mock-brightspace-helper/${path}`),
    sendMessage: vi.fn(async () => ({ success: true })),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(async () => [{ id: 1, url: 'https://brightspace.institution.edu/d2l/home/12345' }]),
  },
};

// Polyfill window.matchMedia for React UI components
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  for (const k in storageStore) delete storageStore[k];
  vi.clearAllMocks();
});

// conversations live in a module-level store: start every test with none
beforeEach(() => resetChatSessions());
