/**
 * src/components/ContextSelectorTree.tsx
 * Hierarchical checklist tree reflecting Brightspace course structure:
 * - Modules, submodules, and child topics (.pdf, .pptx, .docx, .html)
 * - Course Overview, Announcements, Assignments, Quizzes, Calendar, Grades
 * - Live token estimator, item count, Select/Deselect All, search filter
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FileText,
  Presentation,
  FileCode,
  Globe,
  Link as LinkIcon,
  HelpCircle,
  Bell,
  CheckSquare,
  Square,
  Search,
  CheckCircle2,
  FileCheck,
} from 'lucide-react';
import { CourseData, TocModule, TocTopic } from '@/types/brightspace';
import {
  ContextSelection,
  ParsedDocument,
  createEmptyContextSelection,
  createFullContextSelection,
} from '@/types/parser';
import { buildContextBundle, serializeToMarkdown } from '@/services/context/contextSerializer';
import { llm } from '@/services/llm/llmClient';
import { useDrawerLayout } from './LayoutContext';
import { UserFilesSection } from './UserFilesSection';

const COLLAPSED_KEY = 'brightspace-ai-context-scope-collapsed';

export interface ContextSelectorTreeProps {
  courseData: CourseData;
  selection: ContextSelection;
  onSelectionChange: (selection: ContextSelection) => void;
  parsedDocs?: ParsedDocument[] | Record<string, ParsedDocument> | Map<string, ParsedDocument>;
  className?: string;
}

// Helper component for tri-state checkboxes
const TriStateCheckbox: React.FC<{
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}> = ({ checked, indeterminate, onChange, id, disabled, 'aria-label': ariaLabel }) => {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={onChange}
      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
    />
  );
};

export const ContextSelectorTree: React.FC<ContextSelectorTreeProps> = ({
  courseData,
  selection,
  onSelectionChange,
  parsedDocs,
  className = '',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const { expanded } = useDrawerLayout();
  // Side panel: collapsed by default (just the title and the token count); full screen is always open.
  // The choice is remembered for this tab, so it survives switching course (the tree remounts).
  const [collapsedState, setCollapsedState] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(COLLAPSED_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const setCollapsed = (update: (prev: boolean) => boolean) =>
    setCollapsedState((prev) => {
      const next = update(prev);
      try {
        sessionStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // not persisted
      }
      return next;
    });
  const collapsed = collapsedState && !expanded;
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  // Helper mapping parsed document topic IDs
  const parsedDocIds = useMemo(() => {
    const set = new Set<string>();
    if (!parsedDocs) return set;
    if (Array.isArray(parsedDocs)) {
      parsedDocs.forEach((d) => {
        if (d.topicId) set.add(d.topicId);
        if (d.filename) set.add(d.filename);
      });
    } else if (parsedDocs instanceof Map) {
      parsedDocs.forEach((d, k) => {
        set.add(k);
        if (d.topicId) set.add(d.topicId);
        if (d.filename) set.add(d.filename);
      });
    } else {
      Object.entries(parsedDocs).forEach(([k, d]) => {
        set.add(k);
        if (d.topicId) set.add(d.topicId);
        if (d.filename) set.add(d.filename);
      });
    }
    return set;
  }, [parsedDocs]);

  // Compute live estimated token count and item count
  const { tokenCount, selectedItemCount, totalAvailableCount } = useMemo(() => {
    try {
      const bundle = buildContextBundle(courseData, selection, parsedDocs);
      const markdown = serializeToMarkdown(bundle);
      const tokens = llm.estimateTokens(markdown);

      let selectedCount = 0;
      let totalCount = 0;

      if (courseData.overview) {
        totalCount++;
        if (selection.includeOverview) selectedCount++;
      }
      if (courseData.announcements?.length) {
        totalCount += courseData.announcements.length;
        if (selection.includeAnnouncements) selectedCount += courseData.announcements.length;
      }
      if (courseData.assignments?.length) {
        totalCount += courseData.assignments.length;
        if (selection.includeAssignments) selectedCount += courseData.assignments.length;
      }
      if (courseData.quizzes?.length) {
        totalCount += courseData.quizzes.length;
        if (selection.includeQuizzes) selectedCount += courseData.quizzes.length;
      }
      if (courseData.calendar?.length) {
        totalCount += courseData.calendar.length;
        if (selection.includeCalendar) selectedCount += courseData.calendar.length;
      }
      if (courseData.grades?.length) {
        totalCount += courseData.grades.length;
        if (selection.includeGrades) selectedCount += courseData.grades.length;
      }

      // Count topics
      const countTopics = (modules?: TocModule[]) => {
        if (!modules) return;
        for (const mod of modules) {
          totalCount += mod.topics.length;
          for (const topic of mod.topics) {
            if (
              selection.selectedTopicIds.includes(topic.topicId) ||
              selection.selectedModuleIds.includes(mod.moduleId)
            ) {
              selectedCount++;
            }
          }
          if (mod.subModules?.length) countTopics(mod.subModules);
        }
      };
      countTopics(courseData.toc);

      return {
        tokenCount: tokens,
        selectedItemCount: selectedCount,
        totalAvailableCount: totalCount,
      };
    } catch {
      return { tokenCount: 0, selectedItemCount: 0, totalAvailableCount: 0 };
    }
  }, [courseData, selection, parsedDocs]);

  // Toggle module expansion
  const toggleModuleExpand = (moduleId: string) => {
    setExpandedModules((prev) => ({
      ...prev,
      [moduleId]: !prev[moduleId],
    }));
  };

  // Expand / Collapse all
  const handleToggleExpandAll = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    const collect = (modules?: TocModule[]) => {
      if (!modules) return;
      for (const mod of modules) {
        next[mod.moduleId] = expand;
        if (mod.subModules?.length) collect(mod.subModules);
      }
    };
    collect(courseData.toc);
    setExpandedModules(next);
  };

  // Select all / Deselect all
  const handleSelectAll = () => {
    onSelectionChange(createFullContextSelection(courseData));
  };

  const handleDeselectAll = () => {
    onSelectionChange(createEmptyContextSelection());
  };

  // Module & Topic helpers
  const getAllModuleTopicIds = (module: TocModule): string[] => {
    let ids: string[] = module.topics.map((t) => t.topicId);
    if (module.subModules?.length) {
      for (const sub of module.subModules) {
        ids = ids.concat(getAllModuleTopicIds(sub));
      }
    }
    return ids;
  };

  const getAllModuleSubModuleIds = (module: TocModule): string[] => {
    let ids: string[] = [module.moduleId];
    if (module.subModules?.length) {
      for (const sub of module.subModules) {
        ids = ids.concat(getAllModuleSubModuleIds(sub));
      }
    }
    return ids;
  };

  const isModuleChecked = (module: TocModule): boolean => {
    if (selection.selectedModuleIds.includes(module.moduleId)) return true;
    const allTopicIds = getAllModuleTopicIds(module);
    if (allTopicIds.length === 0) return false;
    return allTopicIds.every((id) => selection.selectedTopicIds.includes(id));
  };

  const isModuleIndeterminate = (module: TocModule): boolean => {
    if (selection.selectedModuleIds.includes(module.moduleId)) return false;
    const allTopicIds = getAllModuleTopicIds(module);
    const selectedCount = allTopicIds.filter((id) =>
      selection.selectedTopicIds.includes(id)
    ).length;
    return selectedCount > 0 && selectedCount < allTopicIds.length;
  };

  const toggleModuleSelection = (module: TocModule) => {
    const isCurrentlyChecked = isModuleChecked(module) || isModuleIndeterminate(module);
    const topicIds = getAllModuleTopicIds(module);
    const moduleIds = getAllModuleSubModuleIds(module);

    let nextTopicIds = [...selection.selectedTopicIds];
    let nextModuleIds = [...selection.selectedModuleIds];

    if (isCurrentlyChecked) {
      // Uncheck all
      nextTopicIds = nextTopicIds.filter((id) => !topicIds.includes(id));
      nextModuleIds = nextModuleIds.filter((id) => !moduleIds.includes(id));
    } else {
      // Check all
      nextTopicIds = Array.from(new Set([...nextTopicIds, ...topicIds]));
      nextModuleIds = Array.from(new Set([...nextModuleIds, ...moduleIds]));
    }

    onSelectionChange({
      ...selection,
      selectedTopicIds: nextTopicIds,
      selectedModuleIds: nextModuleIds,
    });
  };

  const toggleTopicSelection = (topicId: string, parentModuleId: string) => {
    const isSelected =
      selection.selectedTopicIds.includes(topicId) ||
      selection.selectedModuleIds.includes(parentModuleId);

    let nextTopicIds = [...selection.selectedTopicIds];
    let nextModuleIds = [...selection.selectedModuleIds];

    if (isSelected) {
      nextTopicIds = nextTopicIds.filter((id) => id !== topicId);
      nextModuleIds = nextModuleIds.filter((id) => id !== parentModuleId);
    } else {
      nextTopicIds.push(topicId);
    }

    onSelectionChange({
      ...selection,
      selectedTopicIds: nextTopicIds,
      selectedModuleIds: nextModuleIds,
    });
  };

  // Icon resolver for file types
  const getTopicIcon = (topic: TocTopic) => {
    const ext = (topic.fileExtension || '').toLowerCase();
    if (ext === 'pdf') return <FileText className="h-4 w-4 text-red-500 shrink-0" />;
    if (ext === 'pptx') return <Presentation className="h-4 w-4 text-amber-500 shrink-0" />;
    if (ext === 'docx') return <FileCode className="h-4 w-4 text-blue-500 shrink-0" />;
    if (ext === 'html') return <Globe className="h-4 w-4 text-emerald-500 shrink-0" />;
    if (topic.type === 'link') return <LinkIcon className="h-4 w-4 text-indigo-500 shrink-0" />;
    return <HelpCircle className="h-4 w-4 text-slate-400 shrink-0" />;
  };

  // Token color styling
  const getTokenBadgeClass = (tokens: number) => {
    if (tokens < 30000) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (tokens < 80000) return 'bg-blue-50 text-blue-700 border-blue-200';
    if (tokens < 150000) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-rose-50 text-rose-700 border-rose-200';
  };

  // Render a recursive module node
  const renderModuleNode = (module: TocModule, depth = 0) => {
    const isExpanded = expandedModules[module.moduleId] ?? true;
    const checked = isModuleChecked(module);
    const indeterminate = isModuleIndeterminate(module);

    // Apply search filter
    const matchesSearch =
      !searchQuery ||
      module.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      module.topics.some((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return null;

    return (
      <div key={module.moduleId} className="select-none text-xs">
        {/* Module Header */}
        <div
          className={`flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-slate-100 transition-colors ${
            depth > 0 ? 'ml-3' : ''
          }`}
        >
          <button
            type="button"
            onClick={() => toggleModuleExpand(module.moduleId)}
            className="p-0.5 text-slate-400 hover:text-slate-600 rounded"
            aria-label={isExpanded ? 'Collapse module' : 'Expand module'}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>

          <TriStateCheckbox
            checked={checked}
            indeterminate={indeterminate}
            aria-label={module.title}
            onChange={() => toggleModuleSelection(module)}
          />

          <Folder className="h-4 w-4 text-blue-600 shrink-0" />

          <span className="font-medium text-slate-800 truncate flex-1" title={module.title}>
            {module.title}
          </span>

          <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full font-mono">
            {module.topics.length}
          </span>
        </div>

        {/* Children (Topics & Submodules) */}
        {isExpanded && (
          <div className={`space-y-0.5 ${depth > 0 ? 'ml-6' : 'ml-4'} border-l border-slate-200 pl-1.5`}>
            {/* Submodules */}
            {module.subModules?.map((sub) => renderModuleNode(sub, depth + 1))}

            {/* Topics */}
            {module.topics.map((topic) => {
              const topicMatches =
                !searchQuery || topic.title.toLowerCase().includes(searchQuery.toLowerCase());
              if (!topicMatches) return null;

              const isTopicSelected =
                selection.selectedTopicIds.includes(topic.topicId) ||
                selection.selectedModuleIds.includes(module.moduleId);

              const isParsed =
                parsedDocIds.has(topic.topicId) ||
                parsedDocIds.has(topic.title) ||
                Boolean(topic.parsedContent);

              return (
                <div
                  key={topic.topicId}
                  className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-slate-50 transition-colors group"
                >
                  <input
                    type="checkbox"
                    checked={isTopicSelected}
                    aria-label={topic.title}
                    onChange={() => toggleTopicSelection(topic.topicId, module.moduleId)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />

                  {getTopicIcon(topic)}

                  <span
                    className={`truncate flex-1 text-slate-700 ${
                      isTopicSelected ? 'font-medium text-slate-900' : 'text-slate-600'
                    }`}
                    title={topic.title}
                  >
                    {topic.title}
                  </span>

                  {/* Badges: Parsed status & Extension */}
                  {isParsed ? (
                    <span
                      title="Parsed & Cached"
                      className="inline-flex items-center text-[10px] text-emerald-600 font-medium px-1 rounded bg-emerald-50 border border-emerald-200 shrink-0"
                    >
                      <FileCheck className="h-2.5 w-2.5 mr-0.5" />
                      Parsed
                    </span>
                  ) : (
                    topic.fileExtension && (
                      <span className="text-[9px] uppercase font-mono px-1 rounded bg-slate-100 text-slate-500 shrink-0">
                        {topic.fileExtension}
                      </span>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col bg-white border border-slate-200 rounded-lg ${className}`}>
      {/* Header bar: Stats, Selection, Controls */}
      <div className={`p-2.5 space-y-2 bg-slate-50/50 rounded-t-lg ${collapsed ? '' : 'border-b border-slate-200'}`}>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            disabled={expanded}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand' : 'Collapse'}
            className="flex items-center gap-1.5 rounded disabled:cursor-default"
          >
            {expanded ? null : collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            )}
            <h3 className="text-xs font-semibold text-slate-700">Context Scope</h3>
          </button>

          {/* Token Estimate Badge */}
          <div
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${getTokenBadgeClass(
              tokenCount
            )}`}
            title="Estimated token length of selected materials (~4 chars/token)"
          >
            <span>~{tokenCount.toLocaleString()} tokens</span>
          </div>
        </div>

        {!collapsed && (
          <>
        {/* Counter & Select All buttons */}
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {selectedItemCount} of {totalAvailableCount} items selected
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium hover:underline"
            >
              Select All
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={handleDeselectAll}
              className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
            >
              Deselect All
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter modules & documents..."
            className="w-full text-xs pl-8 pr-3 py-1.5 border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
          </>
        )}
      </div>

      {/* Checklist Tree Body */}
      {!collapsed && (
      <div className={`flex-1 overflow-y-auto p-2 space-y-2 text-xs ${expanded ? 'min-h-0' : 'max-h-60'}`}>
        {/* 0. The student's own files */}
        <UserFilesSection
          selection={selection}
          onSelectionChange={onSelectionChange}
        />

        {/* 1. Course Overview */}
        {courseData.overview && (
          <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selection.includeOverview}
              onChange={() =>
                onSelectionChange({ ...selection, includeOverview: !selection.includeOverview })
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <FileText className="h-4 w-4 text-blue-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium text-slate-800">Syllabus & Course Overview</span>
              <p className="text-[10px] text-slate-500 truncate">
                {courseData.overview.title || 'Course Description'}
              </p>
            </div>
          </label>
        )}

        {/* 2. Announcements */}
        {courseData.announcements && courseData.announcements.length > 0 && (
          <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selection.includeAnnouncements}
              onChange={() =>
                onSelectionChange({
                  ...selection,
                  includeAnnouncements: !selection.includeAnnouncements,
                })
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <Bell className="h-4 w-4 text-indigo-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium text-slate-800">Announcements / News</span>
              <p className="text-[10px] text-slate-500">
                {courseData.announcements.length} announcement(s)
              </p>
            </div>
          </label>
        )}

        {/* 3. Content Modules Tree */}
        {courseData.toc && courseData.toc.length > 0 && (
          <div className="pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between py-1 px-1 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              <span>Course Content Modules</span>
              <div className="flex items-center gap-1.5 text-[10px] font-normal lowercase">
                <button
                  type="button"
                  onClick={() => handleToggleExpandAll(true)}
                  className="text-blue-600 hover:underline"
                >
                  expand all
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => handleToggleExpandAll(false)}
                  className="text-slate-500 hover:underline"
                >
                  collapse
                </button>
              </div>
            </div>
            <div className="space-y-0.5">
              {courseData.toc.map((module) => renderModuleNode(module))}
            </div>
          </div>
        )}

        {/* 4. Assignments */}
        {courseData.assignments && courseData.assignments.length > 0 && (
          <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer pt-1 border-t border-slate-100">
            <input
              type="checkbox"
              checked={selection.includeAssignments}
              onChange={() =>
                onSelectionChange({
                  ...selection,
                  includeAssignments: !selection.includeAssignments,
                })
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <CheckSquare className="h-4 w-4 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium text-slate-800">Assignments & Rubrics</span>
              <p className="text-[10px] text-slate-500">
                {courseData.assignments.length} folder(s)
              </p>
            </div>
          </label>
        )}

        {/* 5. Quizzes */}
        {courseData.quizzes && courseData.quizzes.length > 0 && (
          <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selection.includeQuizzes}
              onChange={() =>
                onSelectionChange({ ...selection, includeQuizzes: !selection.includeQuizzes })
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <HelpCircle className="h-4 w-4 text-purple-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium text-slate-800">Quizzes & Assessments</span>
              <p className="text-[10px] text-slate-500">{courseData.quizzes.length} quiz(zes)</p>
            </div>
          </label>
        )}

        {/* 6. Calendar */}
        {courseData.calendar && courseData.calendar.length > 0 && (
          <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selection.includeCalendar}
              onChange={() =>
                onSelectionChange({ ...selection, includeCalendar: !selection.includeCalendar })
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <Square className="h-4 w-4 text-orange-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium text-slate-800">Calendar Events & Deadlines</span>
              <p className="text-[10px] text-slate-500">{courseData.calendar.length} event(s)</p>
            </div>
          </label>
        )}

        {/* 7. Grades */}
        {courseData.grades && courseData.grades.length > 0 && (
          <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selection.includeGrades}
              onChange={() =>
                onSelectionChange({ ...selection, includeGrades: !selection.includeGrades })
              }
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium text-slate-800">Grades & Instructor Feedback</span>
              <p className="text-[10px] text-slate-500">{courseData.grades.length} item(s)</p>
            </div>
          </label>
        )}
      </div>
      )}
    </div>
  );
};
