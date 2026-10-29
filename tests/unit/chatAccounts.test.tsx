import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getChatUser,
  importChatSessions,
  registerActiveCourse,
  resetChatSessions,
  setChatUser,
  useChatTabs,
  useSessionRef,
  useSessionState,
} from '@/services/chat/chatSessions';

const useChat = (course: string) => useSessionState<string[]>(course, 'chat.turns', []);

describe('chats belong to the signed-in account', () => {
  afterEach(() => resetChatSessions());

  it('another account never sees the chats, and they come back when the first account signs in again', () => {
    setChatUser('alice');
    registerActiveCourse('c1', 'Course 1');
    const { result } = renderHook(() => useChat('c1'));
    act(() => result.current[1](['alice question']));

    act(() => setChatUser(null)); // signed out
    expect(result.current[0]).toEqual([]);
    act(() => setChatUser('bob'));
    expect(result.current[0]).toEqual([]);
    act(() => result.current[1](['bob question']));

    act(() => setChatUser('alice'));
    expect(result.current[0]).toEqual(['alice question']);
    act(() => setChatUser('bob'));
    expect(result.current[0]).toEqual(['bob question']);
  });

  it('keeps the course tabs of each account', () => {
    setChatUser('alice');
    registerActiveCourse('c1', 'Course 1');
    const chat = renderHook(() => useChat('c1'));
    act(() => chat.result.current[1](['q']));
    act(() => registerActiveCourse('c2', 'Course 2'));
    const tabs = renderHook(() => useChatTabs());
    expect(tabs.result.current.map((t) => t.id)).toEqual(['c1', 'c2']);

    act(() => setChatUser('bob'));
    expect(tabs.result.current.map((t) => t.id)).toEqual(['c2']); // only the course that is open
    act(() => setChatUser('alice'));
    expect(tabs.result.current.map((t) => t.id)).toEqual(['c1', 'c2']);
  });

  it('stops a running request and drops its late answer instead of writing it into the next account', () => {
    setChatUser('alice');
    const { result } = renderHook(() => ({ chat: useChat('c1'), abort: useSessionRef<AbortController | null>('c1', 'chat.abort', null) }));
    const controller = new AbortController();
    result.current.abort.current = controller;
    const lateSetter = result.current.chat[1]; // what a running request holds on to

    act(() => setChatUser('bob'));
    expect(controller.signal.aborted).toBe(true);
    act(() => lateSetter(['answer for alice']));
    expect(result.current.chat[0]).toEqual([]);
  });

  it('a chat restored after opening a source only shows for the account that owned it', () => {
    importChatSessions({ 'c1::chat.turns': ['alice question'] }, 'alice');
    expect(getChatUser()).toBeUndefined();
    const { result } = renderHook(() => useChat('c1'));
    expect(result.current[0]).toEqual([]);

    act(() => setChatUser('bob'));
    expect(result.current[0]).toEqual([]);
    act(() => setChatUser('alice'));
    expect(result.current[0]).toEqual(['alice question']);
  });
});
