import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatBubble } from '@/components/chat/ChatParts';
import { DrawerLayoutContext } from '@/components/LayoutContext';

const bubble = (general?: boolean) => (
  <DrawerLayoutContext.Provider value={{ expanded: false }}>
    <ChatBubble role="assistant" content="TCP is reliable." general={general} />
  </DrawerLayoutContext.Provider>
);

describe('general-knowledge tag', () => {
  it('shows a quiet tag above an answer that is not from the course materials', () => {
    render(bubble(true));
    expect(screen.getByTestId('general-answer-tag')).toHaveTextContent('Not from your course materials');
  });

  it('shows nothing for a normal answer', () => {
    render(bubble());
    expect(screen.queryByTestId('general-answer-tag')).toBeNull();
  });
});
