/**
 * src/components/HelperDrawer.tsx
 * Slide-over React workspace container isolated in the Shadow DOM.
 * Houses HeaderSwitch, CourseSwitcher, ContextSelectorTree, the Chat, and ActionPluginTabs.
 */

import React, { useRef, useState, useEffect } from 'react';
import { DRAWER_EXPANDED_KEY } from '@/services/chat/chatHandoff';
import { X, Settings, Sparkles, Maximize2, Minimize2 } from 'lucide-react';
import { DrawerLayoutContext } from './LayoutContext';
import { HeaderSwitch } from './HeaderSwitch';
import { CourseSwitcher } from './CourseSwitcher';
import { LLMMode } from '@/types/llm';
import { EnrolledCourse } from '@/types/brightspace';

const STORAGE_KEY_EXPANDED = DRAWER_EXPANDED_KEY;

export interface HelperDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourseId: string | null;
  activeCourseName?: string;
  enrolledCourses?: EnrolledCourse[];
  activeMode: LLMMode;
  onModeChange: (mode: LLMMode) => void;
  onCourseChange?: (orgUnitId: string) => void;
  onOpenSettings: () => void;
  /** The course tabs: in the top row's free space in full screen, on their own line in the side panel. */
  headerExtra?: React.ReactNode;
  children?: React.ReactNode;
}

export const HelperDrawer: React.FC<HelperDrawerProps> = ({
  isOpen,
  onClose,
  activeCourseId,
  activeCourseName = 'Brightspace Cursus',
  enrolledCourses = [],
  activeMode,
  onModeChange,
  onCourseChange,
  onOpenSettings,
  headerExtra,
  children,
}) => {
  const drawerRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_EXPANDED) === '1';
    } catch {
      return false;
    }
  });

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_EXPANDED, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Dock Brightspace page alongside the side panel when open in sidebar mode
  const isFirstMountRef = useRef(true);
  const [enablePanelTransitions, setEnablePanelTransitions] = useState(false);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setEnablePanelTransitions(true);
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return;
    const body = document.body;
    const prevTransition = body.style.transition;
    const prevMarginRight = body.style.marginRight;

    // Remove the pre-paint placeholder stylesheet once the React drawer is mounted
    const prepaintStyle = document.getElementById('brightspace-ai-prepaint-style');
    if (prepaintStyle) prepaintStyle.remove();

    // Only animate margin-right on interactive user toggles, not on initial page load
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      body.style.transition = 'none';
    } else {
      body.style.transition = 'margin-right 300ms cubic-bezier(0.22, 1, 0.36, 1)';
    }

    if (isOpen && !expanded) {
      body.style.marginRight = 'min(100vw, 460px)';
    } else {
      body.style.marginRight = '0px';
    }

    return () => {
      body.style.transition = prevTransition;
      body.style.marginRight = prevMarginRight;
    };
  }, [isOpen, expanded]);
  // Bubble phase on purpose: with the capture phase, stopPropagation() here would swallow the key
  // events before they reach inputs inside the drawer (Enter in the chat box stopped working).
  // Stopping it afterwards still keeps the keystrokes away from Brightspace's own page shortcuts.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      // First Escape leaves full-screen, second closes the drawer
      if (expanded) {
        toggleExpanded();
      } else {
        onClose();
      }
    }
  };

  const iconBtn =
    'p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 rounded-md transition-colors';

  const modeSwitch = (
    <HeaderSwitch
      activeMode={activeMode}
      onChange={onModeChange}
      onOpenSettings={onOpenSettings}
    />
  );

  return (
    <DrawerLayoutContext.Provider value={{ expanded }}>
      <div
        className={`fixed inset-0 z-[2147483646] overflow-hidden pointer-events-none transition-all duration-300 ${
          isOpen ? 'visible' : 'invisible'
        }`}
        style={{ height: '100vh', maxHeight: '100dvh' }}
        onKeyDown={handleKeyDown}
      >
        {/* 1. Backdrop Overlay (only active in full-screen mode so Brightspace remains interactive alongside the sidebar) */}
        <div
          id="brightspace-ai-drawer-backdrop"
          onClick={onClose}
          aria-hidden="true"
          className={`fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-300 ${
            isOpen && expanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        />

        {/* 2. Panel Container (side panel or full-screen workspace) */}
        <aside
          ref={drawerRef}
          id="brightspace-ai-helper-drawer"
          role="dialog"
          aria-modal={expanded}
          aria-label="BS Helper Workspace"
          style={{ width: expanded ? '100vw' : 'min(100vw, 460px)', height: '100vh', maxHeight: '100dvh' }}
          className={`fixed top-0 right-0 h-full bg-white text-slate-800 shadow-xl flex flex-col z-[2147483646] pointer-events-auto ${
            enablePanelTransitions
              ? 'transition-[width,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
              : ''
          } ${expanded ? '' : 'border-l border-slate-200'} ${
            isOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {/* Header */}
          <header className="flex flex-col border-b border-slate-200 bg-white px-4 py-2.5 gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#006fbf] to-sky-500 flex items-center justify-center text-white flex-shrink-0">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <h2 className="text-[13px] font-semibold text-slate-900 whitespace-nowrap">
                  Brightspace AI
                </h2>
              </div>

              {expanded ? (
                <div className="flex-1 min-w-0 max-w-[560px]">
                  <CourseSwitcher
                    currentOrgUnitId={activeCourseId}
                    currentCourseName={activeCourseName}
                    enrolledCourses={enrolledCourses}
                    onSelectCourse={onCourseChange}
                  />
                </div>
              ) : null}

              {/* Full screen: the course tabs use the empty space right of the course search, so the
                  header does not grow. (In the side panel there is no room: they fold down, see below.) */}
              <div className="flex-1 min-w-0 flex items-center" data-testid="header-slot">
                {expanded ? headerExtra : null}
              </div>

              <div className="flex-shrink-0">{modeSwitch}</div>

              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={toggleExpanded}
                  title={expanded ? 'Verkleinen (Esc)' : 'Volledig scherm'}
                  aria-label={expanded ? 'Verkleinen' : 'Volledig scherm'}
                  aria-pressed={expanded}
                  className={iconBtn}
                >
                  {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  title="Instellingen openen"
                  aria-label="Instellingen"
                  className={iconBtn}
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  title="Sluiten"
                  aria-label="Sluiten"
                  className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {!expanded && (
              <div className="w-full">
                <CourseSwitcher
                  currentOrgUnitId={activeCourseId}
                  currentCourseName={activeCourseName}
                  enrolledCourses={enrolledCourses}
                  onSelectCourse={onCourseChange}
                />
              </div>
            )}

            {/* Side panel: the tabs fold down onto their own line (rendered only when there are 2+ tabs, so
                nothing moves while there is a single course). */}
            {!expanded && headerExtra}
          </header>

          {/* Main Content Area */}
          <div
            className={`flex-1 min-h-0 bg-slate-50/60 ${
              // side panel: a column in which the chat takes all the height that is left (it scrolls only
              // when even the minimum chat height does not fit)
              expanded ? 'overflow-hidden flex flex-col' : 'overflow-y-auto p-3 flex flex-col'
            }`}
          >
            {children || (
              <div className="text-center py-12 text-slate-500 text-sm">
                <p>Selecteer gewenste cursusinhoud en presets in het menu hieronder.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </DrawerLayoutContext.Provider>
  );
};
