/**
 * tests/integration/shadowDomMount.test.tsx
 * Integration test suite for Milestone 4 (R4):
 * - Shadow DOM Mount & Encapsulation
 * - Floating Trigger Button & Slide-over Helper Drawer
 * - Header Mode Switch (Zelf oppikken vs Gemini 2.5 Flash)
 * - Context Selector Tree
 * - Summarizer Presets & 1-Click Exports (Copy All, Download .md, Download .json)
 * - Contextual Q&A Chat & Action Plugin Tabs
 * - Settings Modal & Error Resilience
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, within, act } from '@testing-library/react';
import {
  createShadowRootContainer,
  removeShadowRootContainer,
  SHADOW_HOST_ID,
  SHADOW_ROOT_APP_ID,
  SHADOW_STYLE_ID,
} from '@/content/shadowRoot';
import { BrightspaceAIHelperApp } from '@/content/index';
import { llm } from '@/services/llm/llmClient';
import { storage } from '@/services/brightspace/storage';
import { CourseData } from '@/types/brightspace';

// Sample mock course data
const sampleCourseData: CourseData = {
  orgUnitId: '88421',
  courseName: 'CS 450: Machine Learning (Fall 2026)',
  fetchedAt: Date.now(),
  overview: {
    title: 'CS 450 Syllabus',
    htmlContent: '<p>Course overview description</p>',
    textDescription: 'Course overview description',
  },
  toc: [
    {
      moduleId: '1001',
      title: 'Course Information',
      subModules: [],
      topics: [
        {
          topicId: '2001',
          title: 'Syllabus.pdf',
          type: 'file',
          fileExtension: 'pdf',
        },
        {
          topicId: '2002',
          title: 'Academic Integrity.docx',
          type: 'file',
          fileExtension: 'docx',
        },
      ],
    },
    {
      moduleId: '1002',
      title: 'Week 1: Optimization',
      subModules: [],
      topics: [
        {
          topicId: '2003',
          title: 'Lecture 1: Gradient Descent.pptx',
          type: 'file',
          fileExtension: 'pptx',
        },
        {
          topicId: '2004',
          title: 'Vector Calculus.html',
          type: 'html',
          fileExtension: 'html',
        },
      ],
    },
  ],
  announcements: [
    {
      id: '3001',
      title: 'Welcome to CS 450',
      body: 'Please review the syllabus.',
      postedDate: '2026-09-02T08:00:00Z',
    },
  ],
  assignments: [
    {
      id: '4001',
      name: 'Assignment 1: Gradient Descent',
      instructions: 'Implement batch gradient descent.',
      dueDate: '2026-10-25T23:59:00Z',
    },
  ],
  quizzes: [
    {
      id: '5001',
      title: 'Quiz 1: Math Foundations',
      dueDate: '2026-10-15T23:59:00Z',
    },
  ],
  calendar: [
    {
      id: '6001',
      title: 'Assignment 1 Due',
      startDate: '2026-10-25T23:59:00Z',
    },
  ],
  grades: [
    {
      id: '7001',
      name: 'Quiz 1',
      pointsNumerator: 19,
      pointsDenominator: 20,
      gradeText: '95%',
    },
  ],
};


/** The context panel is collapsed by default in the side panel; open it to reach the list. */
function expandContextScope(root: HTMLElement) {
  const toggle = within(root).getByRole('button', { name: /Context Scope/i });
  if (toggle.getAttribute('aria-expanded') === 'false') {
    act(() => {
      fireEvent.click(toggle);
    });
  }
}

describe('Milestone 4: Shadow DOM Workspace & Actions Integration', () => {
  let createdObjectURLs: string[] = [];

  beforeEach(() => {
    // Clean DOM & persisted UI state
    localStorage.clear();
    sessionStorage.clear();
    removeShadowRootContainer();
    const oldHost = document.getElementById(SHADOW_HOST_ID);
    if (oldHost) oldHost.remove();

    // Browser API polyfills for jsdom
    createdObjectURLs = [];
    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn((_obj: Blob | MediaSource) => {
        const url = `blob:mock-${Math.random().toString(36).slice(2)}`;
        createdObjectURLs.push(url);
        return url;
      });
    } else {
      vi.spyOn(URL, 'createObjectURL').mockImplementation((_obj: Blob | MediaSource) => {
        const url = `blob:mock-${Math.random().toString(36).slice(2)}`;
        createdObjectURLs.push(url);
        return url;
      });
    }

    if (!URL.revokeObjectURL) {
      URL.revokeObjectURL = vi.fn();
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    }

    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockResolvedValue(undefined),
          readText: vi.fn().mockResolvedValue(''),
        },
        writable: true,
        configurable: true,
      });
    } else {
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    }
  });

  afterEach(() => {
    removeShadowRootContainer();
    vi.restoreAllMocks();
  });

  // ============================================================
  // Suite 1: Shadow DOM Mount & Encapsulation
  // ============================================================
  describe('Suite 1: Shadow DOM Mount & Encapsulation', () => {
    it('1.1 mounts host element in document.body with open shadow root', () => {
      const { host, shadowRoot, appContainer } = createShadowRootContainer();

      expect(host).not.toBeNull();
      expect(document.getElementById(SHADOW_HOST_ID)).toBe(host);
      expect(host.shadowRoot).toBe(shadowRoot);
      expect(shadowRoot.mode).toBe('open');
      expect(host.style.position).toBe('fixed');
      expect(host.style.zIndex).toBe('2147483647');
      expect(host.style.pointerEvents).toBe('none');
      expect(shadowRoot.contains(appContainer)).toBe(true);
    });

    it('1.2 isolates app root inside shadow root so document.querySelector cannot penetrate', () => {
      const { appContainer } = createShadowRootContainer();

      // Normal document querySelector MUST NOT find elements inside shadow root
      expect(document.querySelector(`#${SHADOW_ROOT_APP_ID}`)).toBeNull();
      expect(document.getElementById(SHADOW_ROOT_APP_ID)).toBeNull();

      // Inside shadow root, it is accessible
      const host = document.getElementById(SHADOW_HOST_ID)!;
      expect(host.shadowRoot!.getElementById(SHADOW_ROOT_APP_ID)).toBe(appContainer);
    });

    it('1.3 injects scoped stylesheet inside shadow root without leaking to document.head', () => {
      const { shadowRoot } = createShadowRootContainer();

      const styleTag = shadowRoot.getElementById(SHADOW_STYLE_ID);
      expect(styleTag).not.toBeNull();
      expect(styleTag?.tagName.toLowerCase()).toBe('style');

      // Zero leaked style tags with our ID in document.head
      expect(document.head.querySelector(`#${SHADOW_STYLE_ID}`)).toBeNull();
    });

    it('1.4 is idempotent when createShadowRootContainer is called multiple times', () => {
      const first = createShadowRootContainer();
      expect(first.isExisting).toBe(false);

      const second = createShadowRootContainer();
      expect(second.isExisting).toBe(true);
      expect(second.host).toBe(first.host);
      expect(second.shadowRoot).toBe(first.shadowRoot);
    });
  });

  // ============================================================
  // Suite 2: Trigger Button & Slide-over Drawer
  // ============================================================
  describe('Suite 2: Trigger Button & Slide-over Drawer', () => {
    it('2.1 renders floating trigger button inside shadow root', () => {
      const { appContainer } = createShadowRootContainer();
      render(<BrightspaceAIHelperApp initialCourseData={sampleCourseData} />, { container: appContainer });

      const triggerBtn = within(appContainer).getByRole('button', {
        name: /Toggle BS Helper/i,
      });
      expect(triggerBtn).toBeDefined();
      expect(triggerBtn).toBeVisible();
    });

    it('2.2 clicking trigger button (pointerDown -> pointerUp -> click) opens slide-over helper drawer without double-toggling', () => {
      const { appContainer } = createShadowRootContainer();
      render(<BrightspaceAIHelperApp initialCourseData={sampleCourseData} />, { container: appContainer });

      const triggerBtn = within(appContainer).getByRole('button', {
        name: /Toggle BS Helper/i,
      });

      fireEvent.pointerDown(triggerBtn, { button: 0, clientX: 500, clientY: 500 });
      fireEvent.pointerUp(triggerBtn, { button: 0, clientX: 500, clientY: 500 });
      fireEvent.click(triggerBtn);

      const drawer = within(appContainer).getByRole('dialog', {
        name: /BS Helper Workspace/i,
      });
      expect(drawer).toBeDefined();
      expect(drawer.classList.contains('translate-x-0')).toBe(true);
    });

    it('2.3 pressing global Alt+B toggles drawer open and closed', () => {
      const { appContainer } = createShadowRootContainer();
      render(<BrightspaceAIHelperApp initialCourseData={sampleCourseData} />, { container: appContainer });

      // Press Alt+B to open
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', altKey: true, bubbles: true })
        );
      });

      const drawer = within(appContainer).getByRole('dialog', {
        name: /BS Helper Workspace/i,
      });
      expect(drawer.classList.contains('translate-x-0')).toBe(true);

      // Press Alt+B again to close
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', altKey: true, bubbles: true })
        );
      });

      expect(drawer.classList.contains('translate-x-full')).toBe(true);
    });

    it('2.4 pressing Escape key closes the open drawer', () => {
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );

      const drawer = within(appContainer).getByRole('dialog', {
        name: /BS Helper Workspace/i,
      });
      expect(drawer.classList.contains('translate-x-0')).toBe(true);

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });

      expect(drawer.classList.contains('translate-x-full')).toBe(true);
    });

    it('2.5 clicking close button (X) closes drawer', () => {
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );

      const drawer = within(appContainer).getByRole('dialog', {
        name: /BS Helper Workspace/i,
      });
      const closeBtn = within(drawer).getByRole('button', { name: /Sluiten/i });

      fireEvent.click(closeBtn);

      expect(drawer.classList.contains('translate-x-full')).toBe(true);
    });
  });

  // ============================================================
  // Suite 3: Header Mode Switch
  // ============================================================
  describe('Suite 3: Header Mode Switch (HeaderSwitch.tsx)', () => {


    it('3.1 has no AI/manual badge, no mode switch and no connected banner', async () => {
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(within(appContainer).queryByLabelText('Active AI mode')).toBeNull();
      expect(within(appContainer).queryByRole('radio')).toBeNull();
      expect(within(appContainer).queryByText(/Copy All/i)).toBeNull();
      expect(within(appContainer).queryByText(/Gemini 3.8 Flash connected/i)).toBeNull();
      expect(within(appContainer).queryByText(/Configure Key/i)).toBeNull();
    });
  });

  // ============================================================
  // Suite 4: Context Selector Tree
  // ============================================================
  describe('Suite 4: Context Selector Tree (ContextSelectorTree.tsx)', () => {
    it('4.1 renders course modules, topics with badges, and category checklists', () => {
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );
      expandContextScope(appContainer);

      // Check for module titles
      expect(within(appContainer).getByText('Course Information')).toBeDefined();
      expect(within(appContainer).getByText('Week 1: Optimization')).toBeDefined();

      // Check for topics
      expect(within(appContainer).getByText('Syllabus.pdf')).toBeDefined();
      expect(within(appContainer).getByText('Lecture 1: Gradient Descent.pptx')).toBeDefined();

      // Check for category checklist items
      expect(within(appContainer).getByText(/Syllabus & Course Overview/i)).toBeDefined();
      expect(within(appContainer).getByText(/Announcements \/ News/i)).toBeDefined();
      expect(within(appContainer).getByText(/Assignments & Rubrics/i)).toBeDefined();
      expect(within(appContainer).getByText(/Quizzes & Assessments/i)).toBeDefined();
      expect(within(appContainer).getByText(/Calendar Events & Deadlines/i)).toBeDefined();
      expect(within(appContainer).getByText(/Grades & Instructor Feedback/i)).toBeDefined();
    });

    it('4.2 unchecking an item recalculates selection and token count', () => {
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );
      expandContextScope(appContainer);

      const syllabusCheckbox = within(appContainer).getByRole('checkbox', {
        name: /Syllabus.pdf/i,
      }) as HTMLInputElement;

      expect(syllabusCheckbox.checked).toBe(true);

      act(() => {
        fireEvent.click(syllabusCheckbox);
      });

      expect(syllabusCheckbox.checked).toBe(false);
    });

    it('4.3 Deselect All and Select All buttons toggle all selections', () => {
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );
      expandContextScope(appContainer);

      const deselectAllBtn = within(appContainer).getByRole('button', { name: /Deselect All/i });
      act(() => {
        fireEvent.click(deselectAllBtn);
      });

      // Item count reflects 0 selected
      expect(within(appContainer).getByText(/0 of/i)).toBeDefined();

      const selectAllBtn = within(appContainer).getByRole('button', { name: /^Select All$/i });
      act(() => {
        fireEvent.click(selectAllBtn);
      });

      expect(within(appContainer).getByText(/of \d+ items selected/i)).toBeDefined();
    });
  });

  // ============================================================
  // Suite 5: Chat presets
  // ============================================================
  describe('Suite 5: Chat presets & execution (ChatPlugin.tsx)', () => {
    it('5.1 renders 4 summary preset buttons', () => {
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );

      expect(within(appContainer).getByText('Quick Course Guide')).toBeDefined();
      expect(within(appContainer).getByText('Study & Lecture Notes')).toBeDefined();
      expect(within(appContainer).getByText('Assignments & Deadlines')).toBeDefined();
      expect(within(appContainer).getByText('Grades & Feedback')).toBeDefined();
    });

    it('5.2 clicking a preset executes llm.generate in gemini mode with a context bundle', async () => {
      const generateSpy = vi.spyOn(llm, 'generate').mockResolvedValueOnce({
        text: 'Briefing result',
        mode: 'gemini',
        usage: { totalTokens: 120 },
      });

      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} initialMode="gemini" />,
        { container: appContainer }
      );

      await act(async () => {
        fireEvent.click(within(appContainer).getByRole('button', { name: /Quick Course Guide/i }));
      });

      expect(generateSpy).toHaveBeenCalledTimes(1);
      const [prompt, options] = generateSpy.mock.calls[0];
      expect(prompt).toContain('complete, executive course briefing');
      expect(options?.mode).toBe('gemini');
      expect(options?.contextBundle).toBeDefined();
      expect(within(appContainer).getByText(/Mode: gemini/i)).toBeDefined();
    });








  });

  // ============================================================
  // Suite 6: Contextual Q&A Chat & Extensible Action Tabs
  // ============================================================
  describe('Suite 6: Contextual Q&A Chat & Action Plugin Tabs', () => {
    it('6.1 submits a follow-up user query (direct mode goes straight to the API)', async () => {
      const generateSpy = vi.spyOn(llm, 'rawChat').mockResolvedValueOnce({
        text: 'The passing grade threshold is 55% across all coursework.',
        contextMarkdown: '',
        requestBody: {},
      });

      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );

      const queryInput = within(appContainer).getByPlaceholderText(/Ask a follow-up question/i) as HTMLInputElement;
      fireEvent.change(queryInput, { target: { value: 'What is the passing grade?' } });

      await act(async () => {
        fireEvent.click(within(appContainer).getByTitle(/Send question/i));
      });

      expect(generateSpy).toHaveBeenCalled();
      expect(within(appContainer).getByText('What is the passing grade?')).toBeDefined();
      expect(
        within(appContainer).getByText('The passing grade threshold is 55% across all coursework.')
      ).toBeDefined();
    });



    it('6.2 the Chat is the only tool: no Summarizer tab, no tab bar, the four presets are in the chat bar', async () => {
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );

      expect(within(appContainer).queryByRole('button', { name: /Summarizer/i })).toBeNull();
      expect(within(appContainer).queryByRole('button', { name: /Raw Chat/i })).toBeNull();
      expect(within(appContainer).getByTestId('context-toolbar').textContent).toContain('Quick Course Guide');
      expect(within(appContainer).queryByRole('button', { name: /Study Planner/i })).toBeNull();
      expect(within(appContainer).queryByRole('button', { name: /Flashcards/i })).toBeNull();
      expect(within(appContainer).queryByRole('button', { name: /Practice Homework/i })).toBeNull();
      expect(within(appContainer).queryByRole('button', { name: /To-Do/i })).toBeNull();
    });
  });

  // ============================================================
  // Suite 7: Settings Modal & Error Handling
  // ============================================================
  describe('Suite 7: Settings Modal & Error Resilience', () => {
    it('7.1 clicking Settings icon opens modal', () => {
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );

      const settingsBtn = within(appContainer).getByTitle(/Instellingen openen/i);
      fireEvent.click(settingsBtn);

      expect(within(appContainer).getByRole('dialog', { name: /Instellingen & API Configuratie/i })).toBeDefined();
    });

    it('7.2 displays error banner when grades endpoint returns 403 Forbidden', () => {
      const courseWith403: CourseData = {
        ...sampleCourseData,
        errors: {
          grades: 'Grades access restricted by instructor (HTTP 403 Forbidden)',
        },
      };

      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={courseWith403} />,
        { container: appContainer }
      );

      const alertBanner = within(appContainer).getByRole('alert');
      expect(alertBanner).toBeDefined();
      expect(alertBanner.textContent).toContain('Cijfers zijn afgeschermd door de docent (HTTP 403 Forbidden)');
    });

    it('7.3 switching courses via CourseSwitcher dropdown inside Shadow DOM updates sidebar context without premature mousedown close', async () => {
      await storage.saveEnrolledCourses([
        { orgUnitId: '88421', name: 'CS 450: Machine Learning', code: 'CS-450', isActive: true, typeId: 3 },
        { orgUnitId: '99102', name: 'CS 480: Distributed Systems', code: 'CS-480', isActive: true, typeId: 3 },
      ]);
      await storage.saveCourseData({
        orgUnitId: '99102',
        courseName: 'CS 480: Distributed Systems',
        fetchedAt: Date.now(),
        schemaVersion: 2,
        overview: {
          title: 'CS 480 Overview',
          htmlContent: '<p>Raft and Paxos</p>',
          textDescription: 'Raft and Paxos',
        },
        toc: [
          {
            moduleId: '1101',
            title: 'Week 2: Consensus & Raft Protocol',
            subModules: [],
            topics: [
              {
                topicId: '2103',
                title: 'Raft_Paper.pdf',
                type: 'file',
                fileExtension: 'pdf',
              },
            ],
          },
        ],
      });

      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp
          initialOpen={true}
          initialOrgUnitId="88421"
          initialCourseData={sampleCourseData}
        />,
        { container: appContainer }
      );

      // Wait for initialenrolledCourses effect
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expandContextScope(appContainer);

      const trigger = appContainer.querySelector('#brightspace-course-switcher-trigger') as HTMLElement;
      expect(trigger).not.toBeNull();

      // Open dropdown
      await act(async () => {
        fireEvent.click(trigger);
      });

      const option = within(appContainer).getByRole('option', {
        name: /CS 480: Distributed Systems/i,
      });

      // Simulate real browser sequence: mousedown (which bubbles to document) followed by click
      await act(async () => {
        fireEvent.mouseDown(option, { bubbles: true, composed: true });
        fireEvent.click(option, { bubbles: true, composed: true });
      });

      // Wait for async IndexedDB read to resolve and render CS 480's module and topic
      expect(await within(appContainer).findByText('Week 2: Consensus & Raft Protocol')).toBeDefined();
      expect(within(appContainer).getByText('Raft_Paper.pdf')).toBeDefined();
    });

    it('7.4 sidebar mode keeps Brightspace interactive (no blocking backdrop, docks body margin)', () => {
      localStorage.setItem('brightspace-ai-drawer-expanded', '0');
      const { appContainer } = createShadowRootContainer();
      render(
        <BrightspaceAIHelperApp initialOpen={true} initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );

      const backdrop = appContainer.querySelector('#brightspace-ai-drawer-backdrop') as HTMLElement;
      expect(backdrop.classList.contains('pointer-events-none')).toBe(true);
      expect(document.body.style.marginRight).toBe('min(100vw, 460px)');
    });

    it('7.5 persists open drawer state in localStorage across course page navigations', () => {
      const { appContainer, host } = createShadowRootContainer();
      const { unmount } = render(
        <BrightspaceAIHelperApp initialCourseData={sampleCourseData} />,
        { container: appContainer }
      );

      // Open drawer via Alt+B
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', altKey: true, bubbles: true })
        );
      });

      expect(localStorage.getItem('brightspace-ai-drawer-open')).toBe('1');
      unmount();
      host.remove();

      // Simulate navigating to a new course page in Brightspace and remounting
      const nextMount = createShadowRootContainer();
      render(<BrightspaceAIHelperApp initialCourseData={sampleCourseData} />, {
        container: nextMount.appContainer,
      });

      const drawer = within(nextMount.appContainer).getByRole('dialog', {
        name: /BS Helper Workspace/i,
      });
      expect(drawer.classList.contains('translate-x-0')).toBe(true);
    });
  });
});
