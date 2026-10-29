import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrightspaceAIHelperApp } from '@/content/index';
import { createShadowRootContainer, removeShadowRootContainer, SHADOW_HOST_ID } from '@/content/shadowRoot';
import { CourseSwitcher } from '@/components/CourseSwitcher';
import { storage } from '@/services/brightspace/storage';
import type { CourseData, EnrolledCourse } from '@/types/brightspace';

const courses: EnrolledCourse[] = [
  { orgUnitId: '1', name: 'Oral History', code: 'OH-1', isActive: true },
  { orgUnitId: '2', name: 'Statistics', code: 'ST-2', isActive: true },
  { orgUnitId: '3', name: 'Ethics of AI', code: 'ET-3', isActive: true },
  { orgUnitId: '4', name: 'History of Art', code: 'HA-4', isActive: true },
];

afterEach(cleanup);

const setup = (current: string | null = '1') => {
  const onSelect = vi.fn();
  const view = render(<CourseSwitcher currentOrgUnitId={current} currentCourseName="Oral History" enrolledCourses={courses} onSelectCourse={onSelect} />);
  fireEvent.click(view.getByRole('button', { name: /Oral History/ }));
  const input = view.getByPlaceholderText('Zoek cursus...') as HTMLInputElement;
  const activeName = () => {
    const id = input.getAttribute('aria-activedescendant');
    return id ? document.getElementById(id)?.textContent : undefined;
  };
  const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(input, { key: k, ...init });
  return { ...view, onSelect, input, activeName, key };
};

describe('choosing a course with the keyboard', () => {
  it('opens with the current course highlighted and focus in the search box', () => {
    const { input, activeName } = setup('3');
    expect(document.activeElement).toBe(input);
    expect(activeName()).toContain('Ethics of AI');
    expect(input.getAttribute('role')).toBe('combobox');
  });

  it('arrow keys move the highlight and wrap around', () => {
    const { key, activeName } = setup('1');
    expect(activeName()).toContain('Oral History');
    key('ArrowDown');
    expect(activeName()).toContain('Statistics');
    key('ArrowDown');
    key('ArrowDown');
    expect(activeName()).toContain('History of Art');
    key('ArrowDown'); // wraps to the first
    expect(activeName()).toContain('Oral History');
    key('ArrowUp'); // wraps to the last
    expect(activeName()).toContain('History of Art');
    key('Home');
    expect(activeName()).toContain('Oral History');
    key('End');
    expect(activeName()).toContain('History of Art');
  });

  it('Tab and Shift+Tab walk through the results instead of leaving the list', () => {
    const { key, activeName, input } = setup('1');
    key('Tab');
    expect(activeName()).toContain('Statistics');
    key('Tab');
    expect(activeName()).toContain('Ethics of AI');
    key('Tab', { shiftKey: true });
    expect(activeName()).toContain('Statistics');
    expect(document.activeElement).toBe(input);
  });

  it('Enter selects the highlighted course and closes the list', () => {
    const { key, onSelect, queryByRole } = setup('1');
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('3');
    expect(queryByRole('listbox')).toBeNull();
  });

  it('typing highlights the first match, so "type + Enter" picks it', () => {
    const { input, key, activeName, onSelect, getAllByRole } = setup('1');
    fireEvent.change(input, { target: { value: 'hist' } });
    expect(getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Oral History'),
      expect.stringContaining('History of Art'),
    ]);
    expect(activeName()).toContain('Oral History');
    key('ArrowDown');
    expect(activeName()).toContain('History of Art');
    key('Enter');
    expect(onSelect).toHaveBeenCalledWith('4');
  });

  it('marks the highlighted result (and the mouse follows the same highlight)', () => {
    const { key, getAllByRole } = setup('1');
    const options = () => getAllByRole('option');
    expect(options()[0].getAttribute('data-active')).toBe('true');
    key('ArrowDown');
    expect(options()[1].getAttribute('data-active')).toBe('true');
    expect(options()[0].getAttribute('data-active')).toBeNull();
    fireEvent.mouseEnter(options()[3]);
    expect(options()[3].getAttribute('data-active')).toBe('true');
    key('ArrowUp');
    expect(options()[2].getAttribute('data-active')).toBe('true');
  });

  it('with no results Enter and arrows do nothing; the empty message shows', () => {
    const { input, key, onSelect, getByText } = setup('1');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(getByText('Geen cursussen gevonden')).toBeDefined();
    key('ArrowDown');
    key('Tab');
    key('Enter');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Escape closes only the list, returns focus to the button and selects nothing', () => {
    const { key, onSelect, queryByRole, getByRole } = setup('1');
    key('Escape');
    expect(queryByRole('listbox')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(getByRole('button', { name: /Oral History/ }));
  });

  it('ArrowDown on the closed button opens the list', () => {
    const view = render(<CourseSwitcher currentOrgUnitId="1" currentCourseName="Oral History" enrolledCourses={courses} />);
    const trigger = view.getByRole('button', { name: /Oral History/ });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(view.getByRole('listbox')).toBeDefined();
  });

  it('does not react to keys while an input method composes text', () => {
    const { input, onSelect } = setup('1');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('inside the app: Escape closes the list before it closes the drawer', () => {
  it('first Escape closes the open course list, the drawer stays; the next Escape closes the drawer', async () => {
    removeShadowRootContainer();
    document.getElementById(SHADOW_HOST_ID)?.remove();
    await storage.saveEnrolledCourses(courses);
    const course: CourseData = { orgUnitId: '1', courseName: 'Oral History', fetchedAt: Date.now(), schemaVersion: 2, overview: { title: 'O', htmlContent: '', textDescription: 'x' }, toc: [] };
    const { appContainer } = createShadowRootContainer();
    render(<BrightspaceAIHelperApp initialOpen initialOrgUnitId="1" initialCourseData={course} />, { container: appContainer });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    const drawer = () => within(appContainer).getByRole('dialog', { name: /BS Helper Workspace/i });
    fireEvent.click(appContainer.querySelector('#brightspace-course-switcher-trigger') as HTMLElement);
    const input = within(appContainer).getByPlaceholderText('Zoek cursus...');
    expect(within(appContainer).getByRole('listbox')).toBeDefined();

    await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }); });
    expect(within(appContainer).queryByRole('listbox')).toBeNull();
    expect(drawer().classList.contains('translate-x-0')).toBe(true);

    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(drawer().classList.contains('translate-x-0')).toBe(false);
  });
});
