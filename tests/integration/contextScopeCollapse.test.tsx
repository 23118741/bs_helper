import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextSelectorTree } from '@/components/ContextSelectorTree';
import { DrawerLayoutContext } from '@/components/LayoutContext';
import { createFullContextSelection } from '@/types/parser';
import type { CourseData } from '@/types/brightspace';

const course: CourseData = {
  orgUnitId: '1',
  courseName: 'C',
  fetchedAt: 1,
  overview: { title: 'Overview', htmlContent: '', textDescription: 'overview text' },
  toc: [{ moduleId: 'm', title: 'Week 1', subModules: [], topics: [{ topicId: 't', title: 'Slides.pdf', type: 'file', fileExtension: 'pdf', parsedContent: 'slide text' }] }],
};
beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

const tree = (expanded: boolean) =>
  render(
    <DrawerLayoutContext.Provider value={{ expanded }}>
      <ContextSelectorTree courseData={course} selection={createFullContextSelection(course)} onSelectionChange={() => {}} />
    </DrawerLayoutContext.Provider>
  );

describe('Context Scope in the side panel', () => {
  it('is collapsed by default and then only shows the title and the token count', () => {
    const { getByRole, getByText, queryByPlaceholderText, queryByRole, queryByText, queryByTestId } = tree(false);
    const toggle = getByRole('button', { name: /Context Scope/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(getByText(/~\d[\d,]* tokens/)).toBeDefined();

    expect(queryByPlaceholderText('Filter modules & documents...')).toBeNull(); // no search bar
    expect(queryByRole('button', { name: /^Select All$/i })).toBeNull();
    expect(queryByRole('button', { name: /Deselect All/i })).toBeNull();
    expect(queryByText(/items selected/)).toBeNull();
    expect(queryByTestId('user-files-section')).toBeNull();
    expect(queryByText('Slides.pdf')).toBeNull();
  });

  it('expands on click to show search, select all / deselect all, My files and the list; collapses again', () => {
    const { getByRole, getByPlaceholderText, getByText, queryByPlaceholderText, getByTestId } = tree(false);
    const toggle = getByRole('button', { name: /Context Scope/i });
    act(() => void fireEvent.click(toggle));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(getByPlaceholderText('Filter modules & documents...')).toBeDefined();
    expect(getByRole('button', { name: /^Select All$/i })).toBeDefined();
    expect(getByRole('button', { name: /Deselect All/i })).toBeDefined();
    expect(getByText(/items selected/)).toBeDefined();
    expect(getByTestId('user-files-section')).toBeDefined();
    expect(getByText('Slides.pdf')).toBeDefined();

    act(() => void fireEvent.click(toggle));
    expect(queryByPlaceholderText('Filter modules & documents...')).toBeNull();
  });

  it('the token count stays visible both collapsed and expanded', () => {
    const { getByRole, getByText } = tree(false);
    const before = getByText(/~\d[\d,]* tokens/).textContent;
    act(() => void fireEvent.click(getByRole('button', { name: /Context Scope/i })));
    expect(getByText(/~\d[\d,]* tokens/).textContent).toBe(before);
  });

  it('in full screen it is always open (no collapsing)', () => {
    const { getByRole, getByPlaceholderText } = tree(true);
    expect(getByPlaceholderText('Filter modules & documents...')).toBeDefined();
    expect((getByRole('button', { name: /Context Scope/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the open/closed choice is remembered for the tab', () => {
  it('stays open after the tree remounts (switching course) and collapsed again when the user collapses it', () => {
    const first = tree(false);
    act(() => void fireEvent.click(first.getByRole('button', { name: /Context Scope/i })));
    first.unmount();

    const second = tree(false); // new course → the tree is mounted again
    expect(second.getByRole('button', { name: /Context Scope/i }).getAttribute('aria-expanded')).toBe('true');
    act(() => void fireEvent.click(second.getByRole('button', { name: /Context Scope/i })));
    second.unmount();

    expect(tree(false).getByRole('button', { name: /Context Scope/i }).getAttribute('aria-expanded')).toBe('false');
  });
});
