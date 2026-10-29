import { act, cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CourseTabs } from '@/components/CourseTabs';
import { DrawerLayoutContext } from '@/components/LayoutContext';
import { HelperDrawer } from '@/components/HelperDrawer';
import { registerActiveCourse, useSessionState } from '@/services/chat/chatSessions';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Seed() {
  // course "A" has a conversation, so it stays as a tab when "B" becomes active
  useSessionState('A', 'tool.messages', [{ id: 1 }]);
  return null;
}

const drawer = (expanded: boolean, withTabs: boolean) => {
  // the drawer reads its full-screen state from localStorage
  localStorage.setItem('brightspace-ai-drawer-expanded', expanded ? '1' : '0');
  if (withTabs) {
    act(() => {
      registerActiveCourse('A', 'Oral History');
      registerActiveCourse('B', 'Statistics');
    });
  }
  return render(
    <DrawerLayoutContext.Provider value={{ expanded }}>
      <Seed />
      <HelperDrawer
        isOpen
        onClose={() => {}}
        activeCourseId="B"
        activeCourseName="Statistics"
        activeMode="gemini"
        onModeChange={() => {}}
        onOpenSettings={() => {}}
        headerExtra={<CourseTabs activeCourseId="B" activeCourseName="Statistics" onSelectCourse={() => {}} />}
      />
    </DrawerLayoutContext.Provider>
  );
};

describe('course tabs: inline in full screen, folded down in the side panel', () => {
  it('full screen: tabs sit in the free space of the top row, the header gets no extra row', () => {
    const without = drawer(true, false);
    const rowsWithout = without.container.querySelector('header')!.children.length;
    const classWithout = without.container.querySelector('header')!.className;
    without.unmount();

    const view = drawer(true, true);
    const header = view.container.querySelector('header')!;
    expect(header.children.length).toBe(rowsWithout);
    expect(header.className).toBe(classWithout);
    const slot = within(header.children[0] as HTMLElement).getByTestId('header-slot');
    expect(slot.contains(within(header).getByTestId('course-tabs'))).toBe(true);
    expect(slot.className).toContain('flex-1');
    for (const tab of within(header).getAllByRole('tab')) expect(tab.className).toContain('h-6'); // fits the 28px row
  });

  it('side panel: tabs fold down onto their own line below the course switcher', () => {
    const without = drawer(false, false);
    const rowsWithout = without.container.querySelector('header')!.children.length;
    without.unmount();

    const view = drawer(false, true);
    const header = view.container.querySelector('header')!;
    const tablist = within(header).getByTestId('course-tabs');
    expect(Array.from(header.children)).toContain(tablist); // its own line, directly in the header
    expect(header.children.length).toBe(rowsWithout + 1);
    expect(header.children[header.children.length - 1]).toBe(tablist); // last line, below the switcher
    // not squeezed into the top row
    expect(within(header.children[0] as HTMLElement).getByTestId('header-slot').contains(tablist)).toBe(false);
  });

  it('no tabs (a single course): nothing is added in either mode, so nothing shifts', () => {
    for (const expanded of [false, true]) {
      const baseline = drawer(expanded, false);
      const rows = baseline.container.querySelector('header')!.children.length;
      expect(baseline.queryByTestId('course-tabs')).toBeNull();
      expect(rows).toBe(expanded ? 1 : 2);
      baseline.unmount();
    }
  });

  it('the top-row slot keeps its place (empty) so the buttons do not move', () => {
    const view = drawer(false, false);
    const slot = within(view.container.querySelector('header')!).getByTestId('header-slot');
    expect(slot.className).toContain('flex-1');
    expect(slot.textContent).toBe('');
  });
});
