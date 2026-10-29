import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportChatSessions, importChatSessions, resetChatSessions } from '@/services/chat/chatSessions';
import { consumeHandoff, DRAWER_EXPANDED_KEY, DRAWER_OPEN_KEY, openSourceLink, resetHandoff } from '@/services/chat/chatHandoff';

const click = (over: Partial<Parameters<typeof openSourceLink>[0]> = {}) => {
  const e = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), ...over };
  openSourceLink(e, 'https://school.brightspace.com/d2l/le/content/1/viewContent/2/View');
  return e;
};

describe('opening a source from the chat', () => {
  const assign = vi.fn();
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    resetChatSessions();
    resetHandoff();
    assign.mockReset();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true, configurable: true });
  });

  it('a plain click opens the document in this tab and the chat comes back as a side panel with the same conversation', () => {
    importChatSessions({ '1::chat.turns': [{ role: 'user', text: 'hi' }, { role: 'model', text: 'yo' }], '1::chat.busy': true });
    localStorage.setItem(DRAWER_EXPANDED_KEY, '1'); // was full screen

    const e = click();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('https://school.brightspace.com/d2l/le/content/1/viewContent/2/View');
    expect(localStorage.getItem(DRAWER_EXPANDED_KEY)).toBe('0');
    expect(localStorage.getItem(DRAWER_OPEN_KEY)).toBe('1');

    // the next page load
    resetChatSessions();
    resetHandoff();
    expect(consumeHandoff()).toEqual({ open: true });
    expect(exportChatSessions()).toEqual({ '1::chat.turns': [{ role: 'user', text: 'hi' }, { role: 'model', text: 'yo' }] }); // not the running request
    expect(sessionStorage.getItem('brightspace-ai-chat-handoff')).toBeNull(); // used once
  });

  it('ctrl, cmd, shift and middle click leave the browser to open a new tab, which starts with the chat closed; this tab is untouched', () => {
    for (const over of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      localStorage.clear();
      resetHandoff();
      localStorage.setItem(DRAWER_OPEN_KEY, '1');
      const e = click(over);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
      expect(sessionStorage.getItem('brightspace-ai-chat-handoff')).toBeNull();
      expect(localStorage.getItem(DRAWER_OPEN_KEY)).toBe('1');
      expect(consumeHandoff()).toEqual({ open: false }); // the new tab
      expect(localStorage.getItem('brightspace-ai-new-tab-closed')).toBeNull(); // consumed
    }
  });

  it('an old hand-off or flag is ignored, and a normal page load is not affected', () => {
    sessionStorage.setItem('brightspace-ai-chat-handoff', JSON.stringify({ ts: Date.now() - 60_000, sessions: { '1::chat.turns': [1] } }));
    localStorage.setItem('brightspace-ai-new-tab-closed', String(Date.now() - 60_000));
    expect(consumeHandoff()).toEqual({});
    expect(exportChatSessions()).toEqual({});
  });
});
