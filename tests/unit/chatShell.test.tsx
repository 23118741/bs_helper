import { fireEvent, render, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer, ChatShell } from '@/components/chat/ChatShell';
import { DrawerLayoutContext } from '@/components/LayoutContext';

function Harness({ busy = false, onSubmit = () => {}, onStop = () => {} }: { busy?: boolean; onSubmit?: () => void; onStop?: () => void }) {
  const [v, setV] = useState('');
  return (
    <ChatShell
      scrollKey={0}
      top={<div data-testid="top">presets</div>}
      messages={<div data-testid="messages">hello</div>}
      composer={<ChatComposer value={v} onChange={setV} onSubmit={onSubmit} placeholder="Ask" busy={busy} onStop={onStop} />}
    />
  );
}

describe('ChatShell layout', () => {
  it('orders top, scrolling messages and composer, with the composer pinned last', () => {
    const { getByTestId } = render(<Harness />);
    const shell = getByTestId('chat-shell');
    const kids = Array.from(shell.children) as HTMLElement[];
    expect(kids).toHaveLength(3);
    expect(within(kids[0]).getByTestId('top')).toBeDefined();
    expect(kids[1].className).toContain('overflow-y-auto');
    expect(kids[1].className).toContain('flex-1');
    expect(within(kids[1]).getByTestId('messages')).toBeDefined();
    expect(kids[2].className).toContain('shrink-0');
    expect(within(kids[2]).getByPlaceholderText('Ask')).toBeDefined();
    // fixed height so the input does not move with the amount of content
    expect(shell.className).toMatch(/h-\[min\(640px|h-full/);
  });
});

describe('ChatComposer', () => {
  it('Enter sends, Shift+Enter does not, empty input cannot be sent', () => {
    const onSubmit = vi.fn();
    const { getByPlaceholderText, getByTitle } = render(<Harness onSubmit={onSubmit} />);
    const box = getByPlaceholderText('Ask') as HTMLTextAreaElement;

    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled(); // empty

    fireEvent.change(box, { target: { value: 'question' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(getByTitle('Send question'));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('is locked while busy and shows a stop button instead of send', () => {
    const onStop = vi.fn();
    const { getByPlaceholderText, getByTitle, queryByTitle } = render(<Harness busy onStop={onStop} />);
    expect((getByPlaceholderText('Ask') as HTMLTextAreaElement).disabled).toBe(true);
    expect(queryByTitle('Send question')).toBeNull();
    fireEvent.click(getByTitle('Stop generating'));
    expect(onStop).toHaveBeenCalled();
  });
});

describe('ChatComposer stays compact', () => {
  function Compact({ busy = false, onClear }: { busy?: boolean; onClear?: () => void }) {
    const [v, setV] = useState('');
    return <ChatComposer value={v} onChange={setV} onSubmit={() => {}} placeholder="Ask" busy={busy} onStop={() => {}} onClear={onClear} />;
  }

  it('is a single row: no hint line and no extra "clear conversation" line under or above the input', () => {
    const { container, queryByText } = render(<Compact onClear={() => {}} />);
    const form = container.querySelector('form')!;
    expect(form.children).toHaveLength(1); // only the bordered input box
    expect(queryByText(/Shift\+Enter/)).toBeNull();
    expect(queryByText('Clear conversation')).toBeNull(); // icon only, no text row
  });

  it('keeps the keyboard hint as a tooltip instead of visible text', () => {
    const { getByPlaceholderText } = render(<Compact />);
    expect(getByPlaceholderText('Ask').getAttribute('title')).toBe('Enter to send · Shift+Enter for a new line');
  });

  it('clear conversation is an icon button inside the input row, only when there is something to clear and not while busy', () => {
    const onClear = vi.fn();
    const shown = render(<Compact onClear={onClear} />);
    fireEvent.click(shown.getByTitle('Clear conversation'));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(shown.getByTitle('Clear conversation').closest('form')).not.toBeNull();
    shown.unmount();

    expect(render(<Compact />).queryByTitle('Clear conversation')).toBeNull();
    const busy = render(<Compact busy onClear={onClear} />);
    expect(busy.queryByTitle('Clear conversation')).toBeNull();
  });
});

describe('ChatComposer alignment', () => {
  it('the text line and all buttons share one 28px row height so they sit on the same line', () => {
    function Aligned({ expanded }: { expanded: boolean }) {
      const [v, setV] = useState('');
      return (
        <DrawerLayoutContext.Provider value={{ expanded }}>
          <ChatComposer
            value={v}
            onChange={setV}
            onSubmit={() => {}}
            placeholder="Ask"
            busy={false}
            onStop={() => {}}
            onClear={() => {}}
            attachments={{ items: [], onAdd: () => {}, onRemove: () => {} }}
          />
        </DrawerLayoutContext.Provider>
      );
    }
    for (const expanded of [false, true]) {
      const { getByTitle, getByPlaceholderText, unmount } = render(<Aligned expanded={expanded} />);
      for (const title of ['Attach files to your question', 'Clear conversation', 'Send question']) {
        const cls = getByTitle(title).className;
        expect(cls).toContain('h-7');
        expect(cls).toContain('w-7');
        expect(cls).toContain('items-center');
      }
      // line-height + vertical padding = 28px (16+12 in the side panel, 20+8 in full screen)
      const cls = getByPlaceholderText('Ask').className;
      expect(cls).toContain(expanded ? 'leading-5' : 'leading-4');
      expect(cls).toContain(expanded ? 'py-1' : 'py-1.5');
      unmount();
    }
  });
});
