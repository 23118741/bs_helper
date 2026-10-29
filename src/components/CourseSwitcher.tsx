/**
 * src/components/CourseSwitcher.tsx
 * Dropdown component displaying the active course and allowing the student
 * to switch between enrolled courses discovered via collectEnrolledCourses().
 *
 * Keyboard: the search box keeps focus while you move through the results (listbox pattern with
 * aria-activedescendant). Arrow Down/Up and Tab/Shift+Tab move the highlight (wrapping), Home/End
 * jump to the first/last result, Enter selects the highlighted course, Esc closes the list. Typing
 * highlights the first match, so "type + Enter" picks the best result.
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Search, BookOpen, ExternalLink, RefreshCw } from 'lucide-react';
import { EnrolledCourse } from '@/types/brightspace';
import { getCourseHomeUrl, getBrightspaceOrigin } from '@/services/brightspace/courseDetector';

export interface CourseSwitcherProps {
  currentOrgUnitId: string | null;
  currentCourseName?: string;
  enrolledCourses?: EnrolledCourse[];
  onSelectCourse?: (orgUnitId: string) => void;
  onRefreshCourses?: () => Promise<void>;
  className?: string;
}

export const CourseSwitcher: React.FC<CourseSwitcherProps> = ({
  currentOrgUnitId,
  currentCourseName,
  enrolledCourses = [],
  onSelectCourse,
  onRefreshCourses,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = 'brightspace-course-switcher-listbox';

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus({ preventScroll: true });
    }
  }, [isOpen]);

  // Close dropdown on outside click (uses composedPath() to work inside Shadow DOM)
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!dropdownRef.current) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.length > 0) {
        if (!path.includes(dropdownRef.current)) {
          setIsOpen(false);
        }
      } else if (!dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Filter courses by search term
  const filteredCourses = enrolledCourses.filter(c => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      c.code.toLowerCase().includes(term) ||
      c.orgUnitId.includes(term)
    );
  });

  // Highlight: the first match while typing, the current course when the list opens.
  useEffect(() => {
    setActiveIndex(0);
  }, [searchTerm]);
  useEffect(() => {
    if (!isOpen) return;
    const current = filteredCourses.findIndex((c) => c.orgUnitId === currentOrgUnitId);
    setActiveIndex(current >= 0 ? current : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  // Keep the highlighted result visible while moving with the keyboard.
  useEffect(() => {
    if (isOpen) optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const activeCourse = filteredCourses[Math.min(activeIndex, filteredCourses.length - 1)];

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const count = filteredCourses.length;
    const move = (delta: number) => {
      if (count === 0) return;
      setActiveIndex((i) => (Math.min(i, count - 1) + delta + count) % count);
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Tab':
        e.preventDefault(); // Tab / Shift+Tab walk through the results instead of leaving the list
        move(e.shiftKey ? -1 : 1);
        break;
      case 'Home':
        if (count > 0) {
          e.preventDefault();
          setActiveIndex(0);
        }
        break;
      case 'End':
        if (count > 0) {
          e.preventDefault();
          setActiveIndex(count - 1);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (activeCourse) handleCourseClick(activeCourse);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
        break;
    }
  };

  const displayName = currentCourseName || (currentOrgUnitId ? `Cursus #${currentOrgUnitId}` : 'Geen cursus actief');

  const handleCourseClick = (course: EnrolledCourse) => {
    setIsOpen(false);
    if (onSelectCourse) {
      onSelectCourse(course.orgUnitId);
    }
  };

  const handleNavigateToCourse = (e: React.MouseEvent, orgUnitId: string) => {
    e.stopPropagation();
    setIsOpen(false);
    const origin = typeof window !== 'undefined'
      ? (getBrightspaceOrigin(window.location.href) || window.location.origin)
      : '';
    if (typeof window !== 'undefined') {
      window.location.href = getCourseHomeUrl(origin, orgUnitId);
    }
  };

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRefreshCourses) return;
    setIsRefreshing(true);
    try {
      await onRefreshCourses();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div
      ref={dropdownRef}
      className={`relative ${className}`}
      // while the list is open, Esc closes the list (not the whole drawer): see the global key handler
      {...(isOpen ? { 'data-escape-closes-self': 'true' } : {})}
    >
      {/* Trigger Button */}
      <button
        type="button"
        id="brightspace-course-switcher-trigger"
        ref={triggerRef}
        onClick={() => setIsOpen(prev => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !isOpen) {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        className="flex items-center justify-between w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors shadow-sm text-left gap-1.5"
      >
        <span className="truncate font-medium text-slate-800" title={displayName}>
          {displayName}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          id={listboxId}
          aria-label="Cursussen"
          className="absolute left-0 mt-1 w-full min-w-[280px] bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden flex flex-col text-xs"
        >
          {/* Search Bar */}
          <div
            onMouseDown={e => e.stopPropagation()}
            className="p-2 border-b border-slate-100 flex items-center gap-1.5 bg-slate-50"
          >
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeCourse ? `brightspace-course-option-${activeCourse.orgUnitId}` : undefined}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Zoek cursus..."
              className="w-full bg-transparent border-none text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
            />
            {onRefreshCourses && (
              <button
                type="button"
                onClick={handleRefresh}
                title="Lijst vernieuwen"
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>

          {/* Course List */}
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
            {filteredCourses.length === 0 ? (
              <div className="p-3 text-center text-slate-400">Geen cursussen gevonden</div>
            ) : (
              filteredCourses.map((course, index) => {
                const isSelected = course.orgUnitId === currentOrgUnitId;
                const isActive = index === Math.min(activeIndex, filteredCourses.length - 1);
                return (
                  <div
                    key={course.orgUnitId}
                    id={`brightspace-course-option-${course.orgUnitId}`}
                    ref={(el) => {
                      optionRefs.current[index] = el;
                    }}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    data-active={isActive ? 'true' : undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => handleCourseClick(course)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleCourseClick(course);
                      }
                    }}
                    className={`flex items-center justify-between p-2.5 cursor-pointer transition-colors group ${
                      isSelected ? 'bg-sky-50/70 text-[#006fbf]' : 'text-slate-700'
                    } ${isActive ? 'bg-slate-100 ring-1 ring-inset ring-sky-300' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-start gap-2 min-w-0 pr-1">
                      <BookOpen className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${isSelected ? 'text-sky-600' : 'text-slate-400'}`} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{course.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {course.code} • #{course.orgUnitId}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isSelected && <Check className="w-3.5 h-3.5 text-sky-600" />}
                      <button
                        type="button"
                        onClick={e => handleNavigateToCourse(e, course.orgUnitId)}
                        title="Open cursuspagina"
                        className="p-1 text-slate-300 hover:text-sky-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
