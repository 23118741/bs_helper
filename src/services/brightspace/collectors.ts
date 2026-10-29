import {
  CourseData,
  COURSE_DATA_SCHEMA_VERSION,
  CourseOverview,
  TocModule,
  TocTopic,
  AnnouncementItem,
  AssignmentFolder,
  QuizItem,
  CalendarEvent,
  GradeItem,
  D2LVersionMap,
  EnrolledCourse,
} from '@/types/brightspace';
import { ValenceForbiddenError } from './valenceClient';
import { collectExtras, toFileRefs, getAllPages, richText } from './collectorsExtra';

export interface ValenceClientInterface {
  getVersions(): Promise<D2LVersionMap> | D2LVersionMap;
  get<T>(path: string): Promise<T>;
}

export interface CollectorOptions {
  courseName?: string;
  versions?: D2LVersionMap;
  valenceClient?: ValenceClientInterface;
  skipDom?: boolean;
}

const DEFAULT_VERSIONS: D2LVersionMap = {
  le: '1.74',
  lp: '1.45',
};

// ==========================================
// Helper Utilities & Normalizers
// ==========================================

export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, noscript').forEach(el => el.remove());
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch {
      // Fallback to regex if DOMParser throws
    }
  }
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectTopicType(
  rawTopic: any
): { type: TocTopic['type']; fileExtension?: string } {
  if (!rawTopic || typeof rawTopic !== 'object') {
    return { type: 'unknown' };
  }

  const rawUrl = rawTopic.Url ?? rawTopic.url ?? '';
  const rawTitle = rawTopic.Title ?? rawTopic.title ?? '';
  const rawTypeId = rawTopic.TypeIdentifier ?? rawTopic.type ?? '';

  const urlStr = typeof rawUrl === 'string' ? rawUrl : String(rawUrl);
  const cleanUrl = urlStr.split('?')[0].split('#')[0].toLowerCase();
  const title = (typeof rawTitle === 'string' ? rawTitle : String(rawTitle)).toLowerCase();
  const typeId = (typeof rawTypeId === 'string' ? rawTypeId : String(rawTypeId)).toLowerCase();

  if (cleanUrl.endsWith('.pdf') || title.endsWith('.pdf')) {
    return { type: 'file', fileExtension: 'pdf' };
  }
  if (
    cleanUrl.endsWith('.pptx') ||
    title.endsWith('.pptx') ||
    cleanUrl.endsWith('.ppt') ||
    title.endsWith('.ppt')
  ) {
    return { type: 'file', fileExtension: 'pptx' };
  }
  if (
    cleanUrl.endsWith('.docx') ||
    title.endsWith('.docx') ||
    cleanUrl.endsWith('.doc') ||
    title.endsWith('.doc')
  ) {
    return { type: 'file', fileExtension: 'docx' };
  }
  if (
    cleanUrl.endsWith('.html') ||
    title.endsWith('.html') ||
    cleanUrl.endsWith('.htm') ||
    title.endsWith('.htm') ||
    typeId === 'html'
  ) {
    return { type: 'html', fileExtension: 'html' };
  }
  if (typeId === 'file') {
    return { type: 'file' };
  }
  if (typeId === 'link' || cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
    return { type: 'link' };
  }
  return { type: 'unknown' };
}

export function normalizeTopic(raw: any, orgUnitId: string, leVersion: string): TocTopic {
  if (!raw || typeof raw !== 'object') {
    return {
      topicId: '',
      title: 'Untitled Topic',
      type: 'unknown',
    };
  }

  const { type, fileExtension } = detectTopicType(raw);
  const topicId = String(raw.TopicId ?? raw.Identifier ?? raw.id ?? '');
  const url = typeof raw.Url === 'string' ? raw.Url : typeof raw.url === 'string' ? raw.url : '';
  
  let downloadUrl: string | undefined = undefined;
  if (type === 'file' && topicId) {
    downloadUrl = `/d2l/api/le/${leVersion}/${orgUnitId}/content/topics/${topicId}/file`;
  } else if (url && !url.startsWith('http')) {
    downloadUrl = url.startsWith('/') ? url : `/${url}`;
  }

  const rawTitle = raw.Title ?? raw.title;
  const title =
    rawTitle !== undefined && rawTitle !== null && String(rawTitle).trim() !== ''
      ? String(rawTitle)
      : 'Untitled Topic';

  const topic: TocTopic = {
    topicId,
    title,
    type,
    fileExtension,
    url: url || undefined,
    downloadUrl,
    parsedContent: undefined,
  };
  const description = richText(raw.Description);
  if (description) topic.description = description;
  if (raw.StartDate) topic.startDate = String(raw.StartDate);
  if (raw.EndDate) topic.endDate = String(raw.EndDate);
  if (raw.DueDate) topic.dueDate = String(raw.DueDate);
  if (raw.IsHidden === true) topic.isHidden = true;
  return topic;
}

export function normalizeModule(
  raw: any,
  orgUnitId: string,
  leVersion: string,
  visited: Set<any> = new Set<any>()
): TocModule {
  if (!raw || typeof raw !== 'object') {
    return {
      moduleId: '',
      title: 'Untitled Module',
      subModules: [],
      topics: [],
    };
  }

  const rawId = raw.ModuleId ?? raw.Identifier ?? raw.id;
  const moduleId = rawId !== undefined && rawId !== null ? String(rawId) : '';

  // Cycle detection by object identity or moduleId ancestry, plus recursion depth limit
  if (visited.has(raw) || (moduleId && visited.has(`id:${moduleId}`)) || visited.size > 100) {
    return {
      moduleId,
      title: String(raw.Title ?? raw.title ?? 'Untitled Module'),
      subModules: [],
      topics: [],
    };
  }

  const nextVisited = new Set(visited);
  nextVisited.add(raw);
  if (moduleId) {
    nextVisited.add(`id:${moduleId}`);
  }

  const rawTitle = raw.Title ?? raw.title;
  const title =
    rawTitle !== undefined && rawTitle !== null && String(rawTitle).trim() !== ''
      ? String(rawTitle)
      : 'Untitled Module';

  const description =
    raw.Description?.Text ||
    stripHtml(raw.Description?.Html || (typeof raw.Description === 'string' ? raw.Description : ''));

  const subModules: TocModule[] = Array.isArray(raw.Modules)
    ? raw.Modules
        .filter(Boolean)
        .map((m: any) => normalizeModule(m, orgUnitId, leVersion, nextVisited))
    : [];

  const topics: TocTopic[] = Array.isArray(raw.Topics)
    ? raw.Topics
        .filter(Boolean)
        .map((t: any) => normalizeTopic(t, orgUnitId, leVersion))
    : [];

  return {
    moduleId,
    title,
    description: description || undefined,
    subModules,
    topics,
  };
}

export function normalizeEnrolledCourse(raw: any): EnrolledCourse {
  if (!raw || typeof raw !== 'object') {
    return {
      orgUnitId: '',
      name: 'Untitled Course',
      code: '',
      isActive: false,
    };
  }

  const orgUnit = raw.OrgUnit || raw;
  const access = raw.Access || {};

  const orgUnitId = String(orgUnit.Id ?? orgUnit.id ?? orgUnit.orgUnitId ?? raw.orgUnitId ?? '');
  const rawName = orgUnit.Name ?? orgUnit.name ?? raw.name;
  const name =
    rawName !== undefined && rawName !== null && String(rawName).trim() !== ''
      ? String(rawName)
      : 'Untitled Course';

  const rawCode = orgUnit.Code ?? orgUnit.code ?? raw.code;
  const code = rawCode !== undefined && rawCode !== null ? String(rawCode) : '';

  const startDate = access.StartDate || raw.startDate || undefined;
  const endDate = access.EndDate || raw.endDate || undefined;
  const isActive =
    access.IsActive !== undefined
      ? Boolean(access.IsActive)
      : raw.isActive !== undefined
        ? Boolean(raw.isActive)
        : true;

  const canAccess = access.CanAccess !== undefined ? Boolean(access.CanAccess) : undefined;

  const type = orgUnit.Type ?? {};
  const typeId = Number.isFinite(Number(type.Id)) && type.Id !== undefined && type.Id !== null ? Number(type.Id) : undefined;
  const typeName = typeof type.Code === 'string' && type.Code ? type.Code : typeof type.Name === 'string' && type.Name ? type.Name : undefined;

  return {
    orgUnitId,
    name,
    code,
    startDate,
    endDate,
    isActive,
    ...(canAccess !== undefined ? { canAccess } : {}),
    ...(typeId !== undefined ? { typeId } : {}),
    ...(typeName !== undefined ? { typeName } : {}),
  };
}

/** Brightspace's org unit type of a course: "Course Offering" (id 3 by default). */
const COURSE_OFFERING_TYPE_ID = 3;

/**
 * True for a course. My enrollments also lists the organisation, semesters, departments, course templates and the
 * groups/sections inside courses; those are not courses. An entry without a type is kept.
 */
export function isCourseOffering(course: EnrolledCourse): boolean {
  if (course.typeId === undefined && course.typeName === undefined) return true;
  return course.typeId === COURSE_OFFERING_TYPE_ID || /course\s*offering/i.test(course.typeName ?? '');
}

/**
 * The courses for the course switcher: only real courses the student can open now. Leaves out everything
 * that is not a course offering (also entries without a type once the list has types), inactive or
 * inaccessible courses and courses that have ended. When that leaves nothing (e.g. between semesters),
 * the course offerings are shown after all.
 */
export function mainCourses(courses: EnrolledCourse[], now = Date.now()): EnrolledCourse[] {
  const typed = hasOrgUnitTypes(courses);
  const offerings = courses.filter((c) => isCourseOffering(c) && (!typed || c.typeId !== undefined || c.typeName !== undefined));
  const current = offerings.filter((c) => {
    if (!c.isActive || c.canAccess === false) return false;
    const end = c.endDate ? Date.parse(c.endDate) : NaN;
    return !(Number.isFinite(end) && end < now);
  });
  return current.length > 0 ? current : offerings;
}

/** A course list saved before the type was kept: it may hold non-courses, so discover again. */
export const hasOrgUnitTypes = (courses: EnrolledCourse[]): boolean =>
  courses.some((c) => c.typeId !== undefined || c.typeName !== undefined);

// ==========================================
// 8 Individual Collectors + Enrolled Courses
// ==========================================

export async function collectEnrolledCourses(
  client: ValenceClientInterface,
  lpVersion = DEFAULT_VERSIONS.lp
): Promise<EnrolledCourse[]> {
  const items = await getAllPages(client, `/d2l/api/lp/${lpVersion}/enrollments/myenrollments/`);

  return mainCourses(items.filter(Boolean).map(normalizeEnrolledCourse).filter((c) => c.orgUnitId));
}

export async function collectOverview(
  client: ValenceClientInterface,
  orgUnitId: string,
  leVersion: string
): Promise<CourseOverview> {
  const raw = await client.get<any>(`/d2l/api/le/${leVersion}/${orgUnitId}/overview`);
  if (!raw || typeof raw !== 'object') {
    return { title: 'Course Overview', htmlContent: '', textDescription: '' };
  }
  const title = raw.Title || raw.title || 'Course Overview';
  const htmlContent = raw.Body?.Html || raw.Html || (typeof raw.Body === 'string' ? raw.Body : '');
  const textDescription = raw.Body?.Text || raw.Text || stripHtml(htmlContent);

  return {
    title: String(title),
    htmlContent: typeof htmlContent === 'string' ? htmlContent : '',
    textDescription: typeof textDescription === 'string' ? textDescription : '',
  };
}

export async function collectToc(
  client: ValenceClientInterface,
  orgUnitId: string,
  leVersion: string
): Promise<TocModule[]> {
  const raw = await client.get<any>(`/d2l/api/le/${leVersion}/${orgUnitId}/content/toc`);
  const rawModules = Array.isArray(raw?.Modules) ? raw.Modules : Array.isArray(raw) ? raw : [];
  return rawModules.filter(Boolean).map((mod: any) => normalizeModule(mod, orgUnitId, leVersion));
}

export async function collectNews(
  client: ValenceClientInterface,
  orgUnitId: string,
  leVersion: string
): Promise<AnnouncementItem[]> {
  const raw = await client.get<any>(`/d2l/api/le/${leVersion}/${orgUnitId}/news/`);
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.Objects) ? raw.Objects : [];
  return items.filter(Boolean).map((item: any) => {
    const id = String(item.Id ?? item.id ?? '');
    const announcement: AnnouncementItem = {
      id,
      title: String(item.Title || item.title || 'Untitled Announcement'),
      body: item.Body?.Text || stripHtml(item.Body?.Html || item.Body || ''),
      postedDate: String(item.StartDate || item.postedDate || ''),
    };
    const attachments = toFileRefs(
      item.Attachments,
      (fileId) => `/d2l/api/le/${leVersion}/${orgUnitId}/news/${id}/attachments/${fileId}`
    );
    if (attachments.length > 0) announcement.attachments = attachments;
    return announcement;
  });
}

export async function collectAssignments(
  client: ValenceClientInterface,
  orgUnitId: string,
  leVersion: string
): Promise<AssignmentFolder[]> {
  const raw = await client.get<any>(`/d2l/api/le/${leVersion}/${orgUnitId}/dropbox/folders/`);
  const folders = Array.isArray(raw) ? raw : Array.isArray(raw?.Objects) ? raw.Objects : [];
  return folders.filter(Boolean).map((folder: any) => {
    let rubricSummary: string | undefined = undefined;
    if (folder.Assessment?.Rubrics && Array.isArray(folder.Assessment.Rubrics)) {
      rubricSummary = folder.Assessment.Rubrics
        .filter(Boolean)
        .map((r: any) => r.Name || r.name)
        .filter(Boolean)
        .join(', ');
    }
    const id = String(folder.Id ?? folder.id ?? '');
    const assignment: AssignmentFolder = {
      id,
      name: String(folder.Name || folder.name || 'Untitled Assignment'),
      instructions:
        folder.CustomInstructions?.Text ||
        stripHtml(folder.CustomInstructions?.Html || folder.Instructions || ''),
      dueDate: folder.DueDate || folder.dueDate || undefined,
      rubricSummary: rubricSummary || undefined,
    };
    const startDate = folder.Availability?.StartDate;
    const endDate = folder.Availability?.EndDate;
    if (startDate) assignment.startDate = String(startDate);
    if (endDate) assignment.endDate = String(endDate);
    const maxScore = folder.Assessment?.ScoreDenominator;
    if (typeof maxScore === 'number') assignment.maxScore = maxScore;
    const attachments = toFileRefs(
      folder.Attachments,
      (fileId) => `/d2l/api/le/${leVersion}/${orgUnitId}/dropbox/folders/${id}/attachments/${fileId}`
    );
    if (attachments.length > 0) assignment.attachments = attachments;
    return assignment;
  });
}

export async function collectQuizzes(
  client: ValenceClientInterface,
  orgUnitId: string,
  leVersion: string
): Promise<QuizItem[]> {
  const raw = await client.get<any>(`/d2l/api/le/${leVersion}/${orgUnitId}/quizzes/`);
  const quizzes = Array.isArray(raw) ? raw : Array.isArray(raw?.Objects) ? raw.Objects : [];
  return quizzes.filter(Boolean).map((q: any) => ({
    id: String(q.QuizId ?? q.Id ?? q.id ?? ''),
    title: String(q.Name || q.Title || q.title || 'Untitled Quiz'),
    dueDate: q.DueDate || q.EndDate || q.dueDate || undefined,
    attemptsAllowed: typeof q.AttemptsAllowed === 'number' ? q.AttemptsAllowed : undefined,
  }));
}

export async function collectCalendar(
  client: ValenceClientInterface,
  orgUnitId: string,
  leVersion: string
): Promise<CalendarEvent[]> {
  const now = Date.now();
  const start = new Date(now - 365 * 86400000).toISOString();
  const end = new Date(now + 365 * 86400000).toISOString();
  const raw = await client.get<any>(
    `/d2l/api/le/${leVersion}/${orgUnitId}/calendar/events/?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`
  );
  const events = Array.isArray(raw) ? raw : Array.isArray(raw?.Objects) ? raw.Objects : [];
  return events.filter(Boolean).map((ev: any) => {
    let description: string | undefined = undefined;
    if (ev.Description && typeof ev.Description === 'object') {
      description = ev.Description.Text || stripHtml(ev.Description.Html || '') || undefined;
    } else if (typeof ev.Description === 'string') {
      description = ev.Description;
    } else if (ev.description && typeof ev.description === 'object') {
      description = ev.description.Text || stripHtml(ev.description.Html || '') || undefined;
    } else if (typeof ev.description === 'string') {
      description = ev.description;
    }

    return {
      id: String(ev.CalendarEventId ?? ev.Id ?? ev.id ?? ''),
      title: String(ev.Title || ev.title || 'Untitled Event'),
      description,
      startDate: String(ev.StartDateTime || ev.StartDate || ev.startDate || ''),
      endDate: ev.EndDateTime || ev.EndDate || ev.endDate || undefined,
    };
  });
}

export async function collectGrades(
  client: ValenceClientInterface,
  orgUnitId: string,
  leVersion: string
): Promise<GradeItem[]> {
  try {
    const raw = await client.get<any>(`/d2l/api/le/${leVersion}/${orgUnitId}/grades/values/myGradeValues/`);
    const grades = Array.isArray(raw) ? raw : Array.isArray(raw?.Objects) ? raw.Objects : [];
    return grades.filter(Boolean).map((g: any) => ({
      id: String(g.GradeObjectIdentifier ?? g.Id ?? g.id ?? ''),
      name: String(g.GradeObjectName || g.Name || g.name || 'Untitled Grade Item'),
      pointsNumerator: typeof g.PointsNumerator === 'number' ? g.PointsNumerator : undefined,
      pointsDenominator: typeof g.PointsDenominator === 'number' ? g.PointsDenominator : undefined,
      gradeText:
        g.DisplayedGrade ||
        g.GradeText ||
        (g.PointsNumerator != null && g.PointsDenominator != null
          ? `${g.PointsNumerator}/${g.PointsDenominator}`
          : undefined),
      comments: richText(g.Comments) || undefined,
      weightedNumerator: typeof g.WeightedNumerator === 'number' ? g.WeightedNumerator : undefined,
      weightedDenominator: typeof g.WeightedDenominator === 'number' ? g.WeightedDenominator : undefined,
    }));
  } catch (err: any) {
    if (
      err instanceof ValenceForbiddenError ||
      err?.statusCode === 403 ||
      err?.status === 403 ||
      err?.message?.includes('403')
    ) {
      throw new Error('Grades access restricted by instructor (HTTP 403 Forbidden)');
    }
    throw err;
  }
}

export function extractDomFallbackText(maxLength = 50000): string {
  if (typeof document === 'undefined' || !document.body) {
    return '';
  }
  try {
    const mainEl = document.querySelector('main, #content, [role="main"]') || document.body;
    const clone = mainEl.cloneNode(true) as HTMLElement;
    
    // Remove non-content elements
    const elementsToRemove = clone.querySelectorAll(
      'script, style, noscript, svg, nav, header, footer, iframe, [aria-hidden="true"]'
    );
    elementsToRemove.forEach(el => el.remove());

    const rawText = clone.innerText || clone.textContent || '';
    const cleanText = rawText.replace(/\s+/g, ' ').trim();
    return cleanText.slice(0, maxLength);
  } catch {
    return '';
  }
}

// ==========================================
// Main Resilient Parallel Orchestrator
// ==========================================

export async function collectCourseData(
  orgUnitId: string,
  options: CollectorOptions = {}
): Promise<CourseData> {
  const client = options.valenceClient;
  if (!client) {
    throw new Error('ValenceClient instance required for collection');
  }

  const courseName = options.courseName || `Course ${orgUnitId}`;
  const errors: Record<string, string> = {};

  // 1. Dynamic version discovery with safe fallback
  let versions = options.versions || DEFAULT_VERSIONS;
  try {
    const discovered = await client.getVersions();
    if (discovered && discovered.le) {
      versions = discovered;
    }
  } catch (err: any) {
    errors['versions'] = `Version discovery failed: ${err.message || String(err)}; using default ${DEFAULT_VERSIONS.le}`;
    versions = DEFAULT_VERSIONS;
  }

  const le = versions.le || DEFAULT_VERSIONS.le;

  // 2. Parallel execution of all 8 collectors using Promise.allSettled
  const [
    overviewRes,
    tocRes,
    newsRes,
    assignmentsRes,
    quizzesRes,
    calendarRes,
    gradesRes,
    domRes,
  ] = await Promise.allSettled([
    collectOverview(client, orgUnitId, le),
    collectToc(client, orgUnitId, le),
    collectNews(client, orgUnitId, le),
    collectAssignments(client, orgUnitId, le),
    collectQuizzes(client, orgUnitId, le),
    collectCalendar(client, orgUnitId, le),
    collectGrades(client, orgUnitId, le),
    options.skipDom ? Promise.resolve('') : Promise.resolve(extractDomFallbackText()),
  ]);

  // 3. Process settled results gracefully
  let overview: CourseOverview | undefined;
  if (overviewRes.status === 'fulfilled') {
    overview = overviewRes.value;
  } else {
    errors['overview'] = overviewRes.reason?.message || String(overviewRes.reason);
  }

  let toc: TocModule[] | undefined;
  if (tocRes.status === 'fulfilled') {
    toc = tocRes.value;
  } else {
    errors['toc'] = tocRes.reason?.message || String(tocRes.reason);
  }

  let announcements: AnnouncementItem[] | undefined;
  if (newsRes.status === 'fulfilled') {
    announcements = newsRes.value;
  } else {
    errors['announcements'] = newsRes.reason?.message || String(newsRes.reason);
  }

  let assignments: AssignmentFolder[] | undefined;
  if (assignmentsRes.status === 'fulfilled') {
    assignments = assignmentsRes.value;
  } else {
    errors['assignments'] = assignmentsRes.reason?.message || String(assignmentsRes.reason);
  }

  let quizzes: QuizItem[] | undefined;
  if (quizzesRes.status === 'fulfilled') {
    quizzes = quizzesRes.value;
  } else {
    errors['quizzes'] = quizzesRes.reason?.message || String(quizzesRes.reason);
  }

  let calendar: CalendarEvent[] | undefined;
  if (calendarRes.status === 'fulfilled') {
    calendar = calendarRes.value;
  } else {
    errors['calendar'] = calendarRes.reason?.message || String(calendarRes.reason);
  }

  let grades: GradeItem[] | undefined;
  if (gradesRes.status === 'fulfilled') {
    grades = gradesRes.value;
  } else {
    errors['grades'] = gradesRes.reason?.message || String(gradesRes.reason);
  }

  let domFallbackText: string | undefined;
  if (domRes.status === 'fulfilled') {
    domFallbackText = domRes.value || undefined;
  } else {
    errors['dom'] = domRes.reason?.message || String(domRes.reason);
  }

  const result: CourseData = {
    orgUnitId,
    courseName,
    fetchedAt: Date.now(),
    schemaVersion: COURSE_DATA_SCHEMA_VERSION,
    overview,
    toc,
    announcements,
    assignments,
    quizzes,
    calendar,
    grades,
    domFallbackText,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };

  // 4. Optional enrichment (feedback, quiz attempts, grade details, instructors, discussions).
  // Never fatal: failures land in `extraErrors`.
  try {
    await collectExtras(client, orgUnitId, le, versions.lp || DEFAULT_VERSIONS.lp, result);
  } catch (err: any) {
    result.extraErrors = { ...result.extraErrors, extras: err?.message || String(err) };
  }

  return result;
}
