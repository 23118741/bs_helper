import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatBubble } from '@/components/chat/ChatParts';
import { DrawerLayoutContext } from '@/components/LayoutContext';
import { sumUsage } from '@/services/llm/llmUtils';

const bubble = (props: { tokens?: number; tokensIn?: number; tokensOut?: number }) => (
  <DrawerLayoutContext.Provider value={{ expanded: false }}>
    <ChatBubble role="assistant" content="Answer." {...props} />
  </DrawerLayoutContext.Provider>
);

describe('token usage under an answer', () => {
  it('shows the total with input and output', () => {
    render(bubble({ tokens: 31411, tokensIn: 30000, tokensOut: 1411 }));
    expect(screen.getByTestId('token-usage').textContent).toBe(
      `~${(31411).toLocaleString()} tokens (in ${(30000).toLocaleString()} · out ${(1411).toLocaleString()})`
    );
  });

  it('shows only the total when the split is unknown', () => {
    render(bubble({ tokens: 500 }));
    expect(screen.getByTestId('token-usage').textContent).toBe('~500 tokens');
  });
});

describe('sumUsage', () => {
  it('adds input and output of several requests', () => {
    expect(
      sumUsage([{ usage: { promptTokens: 100, candidateTokens: 10 } }, undefined, { usage: { promptTokens: 50, candidateTokens: 5 } }])
    ).toEqual({ promptTokens: 150, candidateTokens: 15, totalTokens: 165 });
  });

  it('is undefined when nothing reported usage', () => {
    expect(sumUsage([{}, undefined])).toBeUndefined();
  });
});
