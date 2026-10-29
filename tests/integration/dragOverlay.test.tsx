import { act, cleanup, createEvent, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatShell } from '@/components/chat/ChatShell';
import { DRAG_IDLE_MS } from '@/components/chat/useFileDrag';
import { UserFilesSection } from '@/components/UserFilesSection';
import { createFullContextSelection } from '@/types/parser';

const files = { types: ['Files'], files: [new File(['x'], 'a.txt')] };
/** jsdom does not carry relatedTarget through fireEvent init, so set it on the event itself. */
function dragLeave(target: Element, relatedTarget: Element | null) {
  const ev = createEvent.dragLeave(target, { dataTransfer: files });
  Object.defineProperty(ev, 'relatedTarget', { value: relatedTarget });
  fireEvent(target, ev);
}

const overlayText = /Drop files to attach them to your question/;

function Shell({ onFiles }: { onFiles?: (f: File[]) => void }) {
  return (
    <div>
      <div data-testid="outside">outside</div>
      <ChatShell scrollKey={0} onFilesDropped={onFiles} messages={<div data-testid="child">msg</div>} composer={<div data-testid="composer">composer</div>} />
    </div>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the drop overlay always goes away again', () => {
  it('shows while dragging files over the chat, ignores non-file drags', () => {
    const { getByTestId, queryByText } = render(<Shell onFiles={() => {}} />);
    fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: { types: ['text/plain'] } });
    expect(queryByText(overlayText)).toBeNull();
    fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: files });
    expect(queryByText(overlayText)).not.toBeNull();
  });

  it('hides when the pointer leaves the chat (also leaving the window, relatedTarget null)', () => {
    const { getByTestId, queryByText } = render(<Shell onFiles={() => {}} />);
    fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: files });
    dragLeave(getByTestId('chat-shell'), getByTestId('outside'));
    expect(queryByText(overlayText)).toBeNull();

    fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: files });
    dragLeave(getByTestId('chat-shell'), null);
    expect(queryByText(overlayText)).toBeNull();
  });

  it('stays while moving between children of the chat', () => {
    const { getByTestId, queryByText } = render(<Shell onFiles={() => {}} />);
    fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: files });
    dragLeave(getByTestId('child'), getByTestId('composer'));
    expect(queryByText(overlayText)).not.toBeNull();
  });

  it('hides by itself when the drag is cancelled and no events follow (Esc, dropped elsewhere)', () => {
    const { getByTestId, queryByText } = render(<Shell onFiles={() => {}} />);
    fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: files });
    expect(queryByText(overlayText)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(DRAG_IDLE_MS - 50); });
    expect(queryByText(overlayText)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(100); });
    expect(queryByText(overlayText)).toBeNull();
  });

  it('keeps showing as long as the drag continues (dragover keeps arriving)', () => {
    const { getByTestId, queryByText } = render(<Shell onFiles={() => {}} />);
    for (let i = 0; i < 10; i++) {
      fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: files });
      act(() => { vi.advanceTimersByTime(DRAG_IDLE_MS - 100); });
    }
    expect(queryByText(overlayText)).not.toBeNull();
  });

  it('hides on Escape, window dragend, a drop anywhere, and window blur', () => {
    const { getByTestId, queryByText } = render(<Shell onFiles={() => {}} />);
    const show = () => fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: files });

    show();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(queryByText(overlayText)).toBeNull();

    show();
    act(() => void window.dispatchEvent(new Event('dragend')));
    expect(queryByText(overlayText)).toBeNull();

    show();
    act(() => void window.dispatchEvent(new Event('drop')));
    expect(queryByText(overlayText)).toBeNull();

    show();
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(queryByText(overlayText)).toBeNull();
  });

  it('a drop hides the overlay and hands over the files', () => {
    const onFiles = vi.fn();
    const { getByTestId, queryByText } = render(<Shell onFiles={onFiles} />);
    fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: files });
    fireEvent.drop(getByTestId('chat-shell'), { dataTransfer: files });
    expect(queryByText(overlayText)).toBeNull();
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect((onFiles.mock.calls[0][0] as File[])[0].name).toBe('a.txt');
  });

  it('the chat stays usable after a cancelled drag: no overlay blocks the composer', () => {
    const { getByTestId, queryByText } = render(<Shell onFiles={() => {}} />);
    fireEvent.dragOver(getByTestId('chat-shell'), { dataTransfer: files });
    act(() => { vi.advanceTimersByTime(DRAG_IDLE_MS + 100); });
    expect(queryByText(overlayText)).toBeNull();
    expect(getByTestId('composer')).toBeDefined();
  });

  it('the My files drop zone highlight is released the same way', () => {
    const course = { orgUnitId: 'c', courseName: 'C', fetchedAt: 1, toc: [] };
    const { getByTestId } = render(
      <UserFilesSection selection={createFullContextSelection(course)} onSelectionChange={() => {}} />
    );
    const zone = getByTestId('user-files-section');
    expect(zone.className).not.toContain('border-blue-400');
    fireEvent.dragOver(zone, { dataTransfer: files });
    expect(zone.className).toContain('border-blue-400');
    act(() => { vi.advanceTimersByTime(DRAG_IDLE_MS + 100); });
    expect(zone.className).not.toContain('border-blue-400');

    fireEvent.dragOver(zone, { dataTransfer: files });
    dragLeave(zone, document.body);
    expect(zone.className).not.toContain('border-blue-400');
  });
});
