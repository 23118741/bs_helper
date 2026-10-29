import { act, cleanup, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrightspaceAIHelperApp } from '@/content/index';
import { createShadowRootContainer, removeShadowRootContainer, SHADOW_HOST_ID } from '@/content/shadowRoot';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = { orgUnitId: '1', courseName: 'C', fetchedAt: Date.now(), schemaVersion: 2, overview: { title: 'O', htmlContent: '', textDescription: 'x' }, toc: [] };
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  removeShadowRootContainer();
  document.getElementById(SHADOW_HOST_ID)?.remove();
});
afterEach(cleanup);

/** Every ancestor between the chat and the drawer's content area must hand its height down. */
function chainOf(el: HTMLElement, stopAt: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  for (let n: HTMLElement | null = el; n && n !== stopAt; n = n.parentElement) chain.push(n);
  return chain;
}

describe('side panel: the chat takes all the vertical space that is left', () => {
  it('the chat is not a fixed-height box: it is h-full and every ancestor passes the height down', async () => {
    localStorage.setItem('brightspace-ai-drawer-expanded', '0');
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen initialMode="gemini" initialCourseData={course} />, { container: appContainer });
    await flush();

    const shell = within(appContainer).getByTestId('chat-shell');
    expect(shell.className).toContain('h-full');
    expect(shell.className).not.toMatch(/640px|100vh/); // no more fixed height

    const content = shell.closest('aside')!.querySelector(':scope > div.flex-1.min-h-0.bg-slate-50\\/60') as HTMLElement;
    expect(content).not.toBeNull();
    expect(content.className).toContain('flex-col'); // the content area is a column the chat can fill
    expect(content.className).toContain('overflow-y-auto'); // fallback when even the minimum height does not fit

    const chain = chainOf(shell.parentElement!, content).map((n) => n.className);
    // workspace → main (flex-1, with a minimum height) → tool box → plugin wrapper (h-full)
    expect(chain.some((c) => c.includes('flex-1') && c.includes('min-h-[22rem]'))).toBe(true);
    expect(chain.filter((c) => /\bh-full\b/.test(c)).length).toBeGreaterThanOrEqual(2);
  });

  it('the context tree keeps its own height (it does not stretch), so the chat gets the rest', async () => {
    localStorage.setItem('brightspace-ai-drawer-expanded', '0');
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen initialMode="gemini" initialCourseData={course} />, { container: appContainer });
    await flush();
    const treeColumn = within(appContainer).getByRole('button', { name: /Context Scope/i }).closest('aside')!;
    expect(treeColumn.className).toContain('flex-shrink-0');
  });

  it('full screen is unchanged: the chat fills the main area next to the context panel', async () => {
    localStorage.setItem('brightspace-ai-drawer-expanded', '1');
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen initialMode="gemini" initialCourseData={course} />, { container: appContainer });
    await flush();
    expect(within(appContainer).getByTestId('chat-shell').className).toContain('h-full');
  });
});
