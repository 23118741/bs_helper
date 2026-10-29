/**
 * src/content/index.tsx
 * Extension Content Script entry point.
 * Initializes Shadow DOM container, handles the global hotkey (configurable, default Alt+B),
 * mounts top-level BS Helper React application.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Loader2, AlertCircle } from 'lucide-react';
import { createShadowRootContainer } from './shadowRoot';
import { FloatingButton } from '@/components/FloatingButton';
import { HelperDrawer } from '@/components/HelperDrawer';
import { SettingsModal } from '@/components/SettingsModal';
import { LoginView } from '@/components/LoginView';
import { AccountBar } from '@/components/AccountBar';
import { CourseTabs } from '@/components/CourseTabs';
import { DocumentLoadStatus } from '@/components/DocumentLoadStatus';
import { enabledUserDocs, loadUserFiles, useUserFiles } from '@/services/context/userFilesStore';
import { isUserDoc } from '@/services/context/userFiles';
import { DEV_DIRECT_GEMINI } from '@/services/backend/env';
import { refreshSession, sessionStore, useSession } from '@/services/backend/session';
import { loadHotkey, matchesHotkey } from '@/services/ui/preferences';
import { ContextSelectorTree } from '@/components/ContextSelectorTree';
import { ActionPluginTabs } from '@/components/ActionPluginTabs';
import { useDrawerLayout } from '@/components/LayoutContext';
import { isBrightspaceUrl, detectOrgUnitId } from '@/services/brightspace/courseDetector';
import { storage } from '@/services/brightspace/storage';
import { consumeHandoff, DRAWER_OPEN_KEY } from '@/services/chat/chatHandoff';
import { setChatUser } from '@/services/chat/chatSessions';
import { ValenceClient } from '@/services/brightspace/valenceClient';
import { loadCourseDocuments, DocumentLoadProgress } from '@/services/brightspace/documentLoader';
import { collectEnrolledCourses, collectCourseData, hasOrgUnitTypes, mainCourses } from '@/services/brightspace/collectors';
import { getLLMMode, setLLMMode } from '@/services/llm/llmStorage';
import { LLMMode } from '@/types/llm';
import { CourseData, EnrolledCourse, COURSE_DATA_SCHEMA_VERSION } from '@/types/brightspace';
import { ContextSelection, ParsedDocument, createFullContextSelection } from '@/types/parser';

interface CourseWorkspaceProps {
  courseData: CourseData;
  selection: ContextSelection;
  onSelectionChange: (s: ContextSelection) => void;
  parsedDocs: ParsedDocument[];
  currentMode: LLMMode;
  onOpenSettings: () => void;
  isLoading?: boolean;
  docProgress?: DocumentLoadProgress | null;
}

/**
 * Lays out the context tree and action tabs: stacked in the side panel,
 * side-by-side (sidebar + main workspace) in full-screen mode.
 * Uses a single unified DOM container so switching between sidebar and full-screen
 * animates smoothly without unmounting or losing plugin state.
 */
const CourseWorkspace: React.FC<CourseWorkspaceProps> = ({
  courseData,
  selection,
  onSelectionChange,
  parsedDocs,
  currentMode,
  onOpenSettings,
  isLoading = false,
  docProgress = null,
}) => {
  const { expanded } = useDrawerLayout();

  const gradesAlert = courseData.errors?.grades && (
    <div
      role="alert"
      className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 flex items-center gap-2"
    >
      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
      <span>Cijfers zijn afgeschermd door de docent (HTTP 403 Forbidden). Overige onderdelen zijn beschikbaar.</span>
    </div>
  );

  const docStatus = <DocumentLoadStatus progress={docProgress} />;

  // Course documents + the student's own (switched-on) files: this is what the tree and the tools see.
  const { docs: userDocs } = useUserFiles();
  const allDocs = React.useMemo(() => [...parsedDocs, ...enabledUserDocs(userDocs)], [parsedDocs, userDocs]);

  return (
    <div
      className={`flex transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        expanded ? 'flex-1 min-h-0 flex-row gap-4 p-4' : 'flex-col gap-3 flex-1 min-h-0'
      } ${isLoading ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}
    >
      <aside
        className={`flex flex-col gap-3 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          expanded ? 'w-[340px] flex-shrink-0 min-h-0' : 'w-full flex-shrink-0'
        }`}
      >
        {gradesAlert}
        {docStatus}
        <ContextSelectorTree
          key={courseData.orgUnitId}
          courseData={courseData}
          selection={selection}
          onSelectionChange={onSelectionChange}
          parsedDocs={allDocs}
          className={expanded ? 'flex-1 min-h-0' : ''}
        />
      </aside>
      <main
        className={`flex flex-col transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          expanded ? 'flex-1 min-w-0 min-h-0' : 'w-full flex-1 min-h-[22rem]'
        }`}
      >
        <ActionPluginTabs
          courseData={courseData}
          selection={selection}
          parsedDocs={allDocs}
          currentMode={currentMode}
          onOpenSettings={onOpenSettings}
          className="flex-1 min-h-0"
        />
      </main>
    </div>
  );
};

export const STORAGE_KEY_DRAWER_OPEN = DRAWER_OPEN_KEY;
export const STORAGE_KEY_LAST_COURSE_SNAPSHOT = 'brightspace-ai-last-course-snapshot';

export interface BrightspaceAIHelperAppProps {
  initialOpen?: boolean;
  initialCourseData?: CourseData | null;
  initialOrgUnitId?: string | null;
  initialMode?: LLMMode;
}

/**
 * Top-Level Shell Component mounted inside Shadow DOM.
 */
export const BrightspaceAIHelperApp: React.FC<BrightspaceAIHelperAppProps> = ({
  initialOpen,
  initialCourseData = null,
  initialOrgUnitId = null,
  initialMode,
}) => {
  const initialSnapshot = React.useMemo<CourseData | null>(() => {
    if (initialCourseData) return initialCourseData;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_LAST_COURSE_SNAPSHOT);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CourseData;
      const pageId = typeof window !== 'undefined' ? detectOrgUnitId(window.location.href).orgUnitId : null;
      if (parsed && (!pageId || parsed.orgUnitId === pageId)) {
        return parsed;
      }
      return parsed || null;
    } catch {
      return null;
    }
  }, [initialCourseData]);

  const [isDrawerOpen, setIsDrawerOpenState] = useState<boolean>(() => {
    if (initialOpen !== undefined) return initialOpen;
    // opened from a source link: back as a side panel with the same chat (same tab), or closed (new tab)
    const handoff = consumeHandoff();
    if (handoff.open !== undefined) return handoff.open;
    try {
      return localStorage.getItem(STORAGE_KEY_DRAWER_OPEN) === '1';
    } catch {
      return false;
    }
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<LLMMode>(initialMode || (DEV_DIRECT_GEMINI ? 'gemini' : 'backend'));
  const [activeOrgUnitId, setActiveOrgUnitId] = useState<string | null>(
    initialOrgUnitId || initialSnapshot?.orgUnitId || null
  );
  const [activeCourseName, setActiveCourseName] = useState<string>(
    initialSnapshot?.courseName || 'Brightspace Cursus'
  );
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([]);
  const [courseData, setCourseDataState] = useState<CourseData | null>(initialSnapshot);
  const [parsedDocs, setParsedDocs] = useState<ParsedDocument[]>([]);
  const [selection, setSelection] = useState<ContextSelection>(() =>
    initialSnapshot ? createFullContextSelection(initialSnapshot) : createFullContextSelection()
  );
  const [isLoadingCourse, setIsLoadingCourse] = useState(false);
  const [docProgress, setDocProgress] = useState<DocumentLoadProgress | null>(null);
  const [courseError, setCourseError] = useState<string | null>(null);

  const setCourseData = useCallback((next: CourseData | null) => {
    setCourseDataState(next);
    try {
      if (next) {
        sessionStorage.setItem(STORAGE_KEY_LAST_COURSE_SNAPSHOT, JSON.stringify(next));
      } else {
        sessionStorage.removeItem(STORAGE_KEY_LAST_COURSE_SNAPSHOT);
      }
    } catch {
      // ignore quota / storage errors
    }
  }, []);

  const setIsDrawerOpen = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setIsDrawerOpenState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      try {
        localStorage.setItem(STORAGE_KEY_DRAWER_OPEN, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  // Toggle drawer open/close
  const toggleDrawer = useCallback(() => {
    setIsDrawerOpen(prev => !prev);
  }, [setIsDrawerOpen]);

  // Detect active course from current URL or DOM fallback
  const detectCurrentPageCourseId = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    const fromUrl = detectOrgUnitId(window.location.href).orgUnitId;
    if (fromUrl) return fromUrl;
    const domOu = document.getElementById('course-ou-display')?.textContent?.trim();
    if (domOu && /^\d+$/.test(domOu)) return domOu;
    return null;
  }, []);

  // 1. Initialize Active Course & Settings on Mount
  useEffect(() => {
    async function initExtensionState() {
      // Load LLM Mode
      try {
        if (!initialMode) {
          const mode = await getLLMMode();
          setActiveMode(mode);
        }
      } catch (err) {
        console.warn('[Brightspace AI] Failed to read initial LLM mode:', err);
      }

      // Detect active course from current URL or page DOM if not explicitly provided
      const detectedId = initialOrgUnitId || detectCurrentPageCourseId();
      if (!initialOrgUnitId && detectedId) {
        setActiveOrgUnitId(detectedId);
      }

      // Load enrolled courses from storage cache
      try {
        // only courses; a list saved before the org unit type was kept may hold semesters, groups etc.: discover again
        const stored = await storage.getEnrolledCourses();
        const cachedCourses = stored && hasOrgUnitTypes(stored) ? mainCourses(stored) : [];
        if (cachedCourses.length > 0) {
          setEnrolledCourses(cachedCourses);
          const currentId = detectedId || cachedCourses[0]?.orgUnitId || null;
          if (!detectedId && currentId) {
            setActiveOrgUnitId(currentId);
          }
          if (currentId) {
            const match = cachedCourses.find(c => c.orgUnitId === currentId);
            if (match) setActiveCourseName(match.name);
          }
        } else {
          // Discover enrolled courses in background via Valence
          const client = new ValenceClient();
          const discovered = await collectEnrolledCourses(client);
          if (discovered && discovered.length > 0) {
            setEnrolledCourses(discovered);
            await storage.saveEnrolledCourses(discovered);
            const currentId = detectedId || discovered[0]?.orgUnitId || null;
            if (!detectedId && currentId) {
              setActiveOrgUnitId(currentId);
            }
            if (currentId) {
              const match = discovered.find(c => c.orgUnitId === currentId);
              if (match) setActiveCourseName(match.name);
            }
          }
        }
      } catch (err) {
        console.warn('[Brightspace AI] Enrolled courses discovery fallback:', err);
      }
    }

    initExtensionState();
  }, [initialOrgUnitId, initialMode, detectCurrentPageCourseId]);

  // 1b. Detect in-page Brightspace course changes (URL changes or course banner updates)
  useEffect(() => {
    if (initialOrgUnitId || typeof window === 'undefined') return;
    let lastSeenUrl = window.location.href;
    let lastSeenDomOu = document.getElementById('course-ou-display')?.textContent?.trim() || null;

    const syncPageCourse = () => {
      const currentUrl = window.location.href;
      const domOu = document.getElementById('course-ou-display')?.textContent?.trim() || null;

      if (currentUrl !== lastSeenUrl) {
        lastSeenUrl = currentUrl;
        const detected = detectOrgUnitId(currentUrl).orgUnitId;
        if (detected) {
          setActiveOrgUnitId(prev => (prev !== detected ? detected : prev));
          return;
        }
      }

      if (domOu && /^\d+$/.test(domOu) && domOu !== lastSeenDomOu) {
        lastSeenDomOu = domOu;
        setActiveOrgUnitId(prev => (prev !== domOu ? domOu : prev));
      }
    };

    window.addEventListener('popstate', syncPageCourse);
    window.addEventListener('hashchange', syncPageCourse);
    const intervalId = window.setInterval(syncPageCourse, 500);

    return () => {
      window.removeEventListener('popstate', syncPageCourse);
      window.removeEventListener('hashchange', syncPageCourse);
      window.clearInterval(intervalId);
    };
  }, [initialOrgUnitId]);

  // 2. Load Course Data and Parsed Documents when activeOrgUnitId changes
  useEffect(() => {
    if (!activeOrgUnitId) return;

    const matchedCourse = enrolledCourses.find(c => c.orgUnitId === activeOrgUnitId);
    const resolvedCourseName =
      matchedCourse?.name ||
      (initialCourseData?.orgUnitId === activeOrgUnitId ? initialCourseData.courseName : undefined) ||
      `Cursus #${activeOrgUnitId}`;

    if (matchedCourse?.name) {
      setActiveCourseName(matchedCourse.name);
    }

    if (initialCourseData && initialCourseData.orgUnitId === activeOrgUnitId) {
      setCourseData(initialCourseData);
      setActiveCourseName(initialCourseData.courseName);
      setSelection(createFullContextSelection(initialCourseData));
      return;
    }

    let isMounted = true;
    async function loadData() {
      setIsLoadingCourse(true);
      setCourseError(null);
      setParsedDocs([]);
      try {
        // Load cached parsed documents
        try {
          const docs = await storage.getParsedDocumentsForCourse(activeOrgUnitId!);
          // the student's own files live in the user-files store, not in this list
          if (isMounted && docs) setParsedDocs(docs.filter((d) => !isUserDoc(d)));
        } catch {
          // ignore cache read failure
        }

        // Check if current page DOM belongs to this orgUnitId (avoid scraping wrong course's page DOM when switching via dropdown)
        const pageOrgUnitId =
          typeof window !== 'undefined' ? detectOrgUnitId(window.location.href).orgUnitId : null;
        const isCurrentPageCourse = !pageOrgUnitId || pageOrgUnitId === activeOrgUnitId;

        // Try IndexedDB cache first
        const cached = await storage.getCourseData(activeOrgUnitId!);
        if (
          cached &&
          !storage.isCacheExpired(cached.fetchedAt) &&
          (cached.schemaVersion ?? 1) >= COURSE_DATA_SCHEMA_VERSION
        ) {
          if (isMounted) {
            const finalName = matchedCourse?.name || cached.courseName || resolvedCourseName;
            const updatedCached =
              cached.courseName !== finalName ? { ...cached, courseName: finalName } : cached;
            setCourseData(updatedCached);
            setActiveCourseName(finalName);
            setSelection(createFullContextSelection(updatedCached));
            setIsLoadingCourse(false);
          }
          return;
        }

        // Fresh collection
        const client = new ValenceClient();
        const fresh = await collectCourseData(activeOrgUnitId!, {
          valenceClient: client,
          courseName: resolvedCourseName,
          skipDom: !isCurrentPageCourse,
        });

        if (isMounted) {
          setCourseData(fresh);
          setActiveCourseName(fresh.courseName);
          setSelection(createFullContextSelection(fresh));
          await storage.saveCourseData(fresh);
          setIsLoadingCourse(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setCourseError(err?.message || 'Fout bij het laden van cursusdata');
          setIsLoadingCourse(false);
        }
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [activeOrgUnitId, initialCourseData, enrolledCourses]);

  // 2a. Load the student's own files once: they stay when switching course
  useEffect(() => {
    void loadUserFiles(activeOrgUnitId ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2b. Download + parse every PDF/PPTX/DOCX file topic so it reaches the LLM context
  const docsCourseId = courseData?.orgUnitId;
  useEffect(() => {
    if (!courseData || !docsCourseId) return;
    const controller = new AbortController();
    setDocProgress(null);
    loadCourseDocuments(courseData, {
      signal: controller.signal,
      onProgress: (p) => {
        if (!controller.signal.aborted) setDocProgress(p);
      },
      onDocument: (doc) => {
        if (controller.signal.aborted) return;
        setParsedDocs((prev) =>
          prev.some((d) => d.topicId === doc.topicId) ? prev : [...prev, doc]
        );
      },
    }).catch((err) => console.warn('[BS Helper] Document loading failed:', err));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docsCourseId]);

  // 3. Global Hotkey Listener: configurable shortcut & Esc
  useEffect(() => {
    void loadHotkey();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // The chosen shortcut (Settings → Keyboard shortcut, default Alt+B) toggles the drawer
      if (matchesHotkey(e)) {
        e.preventDefault();
        e.stopPropagation();
        toggleDrawer();
        return;
      }

      // Esc closes settings modal if open, else closes drawer if open
      if (e.key === 'Escape') {
        // an open course list closes itself first (it is part of the event path while focused)
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        if (path.some((n) => n instanceof Element && n.hasAttribute('data-escape-closes-self'))) return;

        if (isSettingsOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsSettingsOpen(false);
        } else if (isDrawerOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsDrawerOpen(false);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isDrawerOpen, isSettingsOpen, toggleDrawer]);

  // 4. Chrome Runtime Message Listener (Action Icon Click / Command)
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      const messageListener = (msg: any) => {
        if (msg?.type === 'TOGGLE_DRAWER') {
          toggleDrawer();
        } else if (msg?.type === 'OPEN_SETTINGS') {
          setIsSettingsOpen(true);
        }
      };
      chrome.runtime.onMessage.addListener(messageListener);
      return () => {
        chrome.runtime.onMessage.removeListener(messageListener);
      };
    }
  }, [toggleDrawer]);

  // Backend mode requires a login: check the stored session once, then react to sign-in/out.
  const session = useSession();
  useEffect(() => {
    if (activeMode === 'backend') refreshSession().catch(() => sessionStore.markSignedOut());
  }, [activeMode]);
  // Chats belong to the account that is signed in; signing out also closes Settings (it shows the old account)
  const signedInUserId = session.status === 'signedIn' ? session.user?.id ?? null : null;
  useEffect(() => {
    if (activeMode !== 'backend' || session.status === 'loading') return;
    setChatUser(signedInUserId);
    if (session.status === 'signedOut') setIsSettingsOpen(false);
  }, [activeMode, session.status, signedInUserId]);
  const authView =
    activeMode !== 'backend' ? null : session.status === 'loading' ? (
      <div className="flex items-center justify-center gap-2 text-slate-400 text-xs py-12">
        <Loader2 className="w-4 h-4 animate-spin text-[#006fbf]" />
        <span>Checking session...</span>
      </div>
    ) : session.status === 'signedOut' ? (
      <LoginView />
    ) : null;

  // Handle mode change
  const handleModeChange = useCallback(async (newMode: LLMMode) => {
    setActiveMode(newMode);
    await setLLMMode(newMode);
  }, []);

  return (
    <>
      <FloatingButton
        isOpen={isDrawerOpen}
        onToggle={toggleDrawer}
        status={isLoadingCourse ? 'loading' : courseError ? 'error' : 'ready'}
      />

      <HelperDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        activeCourseId={activeOrgUnitId}
        activeCourseName={activeCourseName}
        enrolledCourses={enrolledCourses}
        activeMode={activeMode}
        onModeChange={handleModeChange}
        onCourseChange={(newId) => setActiveOrgUnitId(newId)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        headerExtra={
          <CourseTabs
            activeCourseId={activeOrgUnitId}
            activeCourseName={activeCourseName}
            onSelectCourse={(id) => setActiveOrgUnitId(id)}
          />
        }
      >
        {authView ?? (
          <>
        {activeMode === 'backend' && <AccountBar />}
        {courseData ? (
          <CourseWorkspace
            courseData={courseData}
            selection={selection}
            onSelectionChange={setSelection}
            parsedDocs={parsedDocs}
            currentMode={activeMode}
            onOpenSettings={() => setIsSettingsOpen(true)}
            isLoading={isLoadingCourse}
            docProgress={docProgress}
          />
        ) : isLoadingCourse ? (
          <div className="flex flex-col gap-3 p-1 animate-pulse select-none" aria-busy="true">
            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="h-3.5 w-28 bg-slate-200 rounded" />
                <div className="h-4 w-20 bg-slate-100 rounded-full" />
              </div>
              <div className="h-7 w-full bg-slate-100 rounded-md" />
              <div className="space-y-2 pt-1">
                <div className="h-4 w-3/4 bg-slate-100 rounded" />
                <div className="h-4 w-5/6 bg-slate-100 rounded" />
                <div className="h-4 w-2/3 bg-slate-100 rounded" />
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
              <div className="flex gap-1.5">
                <div className="h-6 w-20 bg-slate-200 rounded-md" />
                <div className="h-6 w-20 bg-slate-100 rounded-md" />
                <div className="h-6 w-20 bg-slate-100 rounded-md" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="h-14 bg-slate-100 rounded-lg" />
                <div className="h-14 bg-slate-100 rounded-lg" />
              </div>
              <div className="h-24 bg-slate-50 rounded-lg" />
            </div>
            <div className="flex items-center justify-center gap-2 text-slate-400 text-[11px] pt-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#006fbf]" />
              <span>Cursusdata ophalen uit Brightspace...</span>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-slate-500 text-sm">
            <p>Geen cursusdata gevonden voor #{activeOrgUnitId || 'onbekend'}.</p>
          </div>
        )}
          </>
        )}
      </HelperDrawer>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        activeCourseId={activeOrgUnitId}
        onSettingsSaved={(updated) => {
          setActiveMode(updated.mode);
        }}
        onCacheCleared={() => {
          setCourseData(null);
          void loadUserFiles(activeOrgUnitId ?? undefined);
        }}
      />
    </>
  );
};

export default BrightspaceAIHelperApp;

/**
 * Content Script Initialization Function
 */
export function initBrightspaceAIHelper(): void {
  // Guard: Run only on Brightspace domains or mock page
  if (typeof window !== 'undefined' && !isBrightspaceUrl(window.location.href)) {
    return;
  }

  // Create isolated Shadow DOM container
  const { appContainer } = createShadowRootContainer();

  // Mount React 18 application
  const root = createRoot(appContainer);
  root.render(<BrightspaceAIHelperApp />);

  console.log('[BS Helper] Injected and mounted successfully into Shadow DOM');
}

// Auto-run when content script executes
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBrightspaceAIHelper);
  } else {
    initBrightspaceAIHelper();
  }
}
