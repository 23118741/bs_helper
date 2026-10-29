/**
 * src/components/CourseTabs.tsx
 * Browser-style tabs in the header. Full screen: in the free space of the top row (no extra height).
 * Side panel: folded down onto their own line. the course you are in plus every other course where you have a
 * chat going. Click a tab to go back to that course (its chat is exactly as you left it, also while
 * an answer was still being generated), close a tab to discard that course's chat. Only visible
 * when there is more than one tab.
 */

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { closeChatTab, registerActiveCourse, useChatTabs } from '@/services/chat/chatSessions';

export interface CourseTabsProps {
  activeCourseId: string | null;
  activeCourseName: string;
  onSelectCourse: (orgUnitId: string) => void;
}

export const CourseTabs: React.FC<CourseTabsProps> = ({ activeCourseId, activeCourseName, onSelectCourse }) => {
  useEffect(() => {
    if (activeCourseId) registerActiveCourse(activeCourseId, activeCourseName);
  }, [activeCourseId, activeCourseName]);

  const tabs = useChatTabs();
  if (tabs.length < 2) return null;

  const close = (id: string) => {
    const index = tabs.findIndex((t) => t.id === id);
    const neighbour = tabs[index + 1] ?? tabs[index - 1];
    closeChatTab(id);
    if (id === activeCourseId && neighbour) onSelectCourse(neighbour.id);
  };

  return (
    <div
      role="tablist"
      aria-label="Courses with an open chat"
      data-testid="course-tabs"
      className="flex w-full items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeCourseId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            data-tab-id={tab.id}
            className={`group flex h-6 items-center gap-1 min-w-0 max-w-[9rem] flex-shrink-0 rounded-md border pl-2 pr-0.5 text-[11px] transition-colors ${
              active
                ? 'bg-white border-slate-300 text-slate-900 font-medium shadow-sm'
                : 'bg-slate-100 border-transparent text-slate-500 hover:bg-slate-200/70 hover:text-slate-700'
            }`}
          >
            <button
              type="button"
              onClick={() => !active && onSelectCourse(tab.id)}
              title={tab.name}
              className="flex items-center gap-1.5 min-w-0 text-left"
            >
              {tab.busy && (
                <span
                  className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500 animate-pulse"
                  title="Generating an answer"
                />
              )}
              <span className="truncate">{tab.name}</span>
            </button>
            <button
              type="button"
              onClick={() => close(tab.id)}
              aria-label={`Close chat for ${tab.name}`}
              title="Close tab and discard its chat"
              className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-300/70 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
