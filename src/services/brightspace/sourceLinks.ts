/**
 * src/services/brightspace/sourceLinks.ts
 * Turns a citation in an answer ("[Lecture 3 Slide 14]", "[Source: Syllabus p. 2]") into a link to the
 * document in Brightspace. The match is on the document title; a citation that matches nothing (or more
 * than one document) is not linked.
 */

import type { AssignmentFolder, CourseData, TocModule } from '@/types/brightspace';

export type SourceResolver = (citation: string) => string | undefined;

interface Target {
  key: string;
  url: string;
}

/** Lower case, no file extension or punctuation, single spaces. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.(pdf|pptx?|docx?|html?|xlsx?)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The part of a citation that names the document: no brackets, "Source:" prefix or slide/page locator. */
export function citationBase(citation: string): string {
  return norm(
    citation
      .replace(/^\[|\]$/g, '')
      .replace(/^\s*(?:source|bron)\s*:\s*/i, '')
      .replace(/[,;(]?\s*\b(?:slides?|dia'?s?|pages?|pagina'?s?|pp?\.?|sheet)\s*\d[\d\s,–-]*\)?\s*$/i, '')
  );
}

function collectTopics(modules: TocModule[] | undefined, out: Array<{ title: string; topicId: string }>): void {
  for (const m of modules ?? []) {
    for (const t of m.topics ?? []) out.push({ title: t.title, topicId: t.topicId });
    collectTopics(m.subModules, out);
  }
}

/** Whole sections of the course, for citations such as [Grades] or [Calendar] that name no single document. */
const SECTIONS: Array<{ words: string[]; path: (ou: string) => string }> = [
  { words: ['grades', 'grade', 'cijfers', 'cijfer', 'gradebook'], path: (ou) => `/d2l/lms/grades/my_grades/main.d2l?ou=${ou}` },
  { words: ['calendar', 'kalender', 'schedule', 'rooster'], path: (ou) => `/d2l/le/calendar/${ou}` },
  { words: ['announcements', 'announcement', 'news', 'nieuws', 'mededelingen'], path: (ou) => `/d2l/lms/news/main.d2l?ou=${ou}` },
  { words: ['assignments', 'opdrachten', 'dropbox'], path: (ou) => `/d2l/lms/dropbox/user/folders_list.d2l?ou=${ou}` },
  { words: ['quizzes', 'quiz', 'toetsen', 'exams'], path: (ou) => `/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${ou}` },
  { words: ['discussions', 'discussion', 'forum', 'forums'], path: (ou) => `/d2l/le/${ou}/discussions/List` },
  { words: ['course overview', 'overview', 'course home', 'cursusoverzicht'], path: (ou) => `/d2l/home/${ou}` },
];

const dropboxUrl = (origin: string, orgUnitId: string, a: AssignmentFolder): string =>
  `${origin}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${encodeURIComponent(a.id)}&grpid=0&isprv=0&bp=0&ou=${orgUnitId}`;

export function buildSourceResolver(courseData: CourseData, origin: string): SourceResolver {
  const base = origin.replace(/\/+$/, '');
  const ou = courseData.orgUnitId;
  const targets: Target[] = [];

  const topics: Array<{ title: string; topicId: string }> = [];
  collectTopics(courseData.toc, topics);
  for (const t of topics) {
    if (/^(user|att):/.test(t.topicId)) continue;
    targets.push({ key: norm(t.title), url: `${base}/d2l/le/content/${ou}/viewContent/${t.topicId}/View` });
  }
  for (const a of courseData.assignments ?? []) {
    const url = dropboxUrl(base, ou, a);
    targets.push({ key: norm(a.name), url });
    // the files of an assignment (and its feedback file) open on the assignment page
    for (const f of a.attachments ?? []) targets.push({ key: norm(f.fileName), url });
    for (const f of a.feedback?.files ?? []) targets.push({ key: norm(f.fileName), url });
  }
  for (const q of courseData.quizzes ?? []) {
    targets.push({ key: norm(q.title), url: `${base}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${encodeURIComponent(q.id)}&ou=${ou}` });
  }
  const newsUrl = `${base}/d2l/lms/news/main.d2l?ou=${ou}`;
  for (const n of courseData.announcements ?? []) {
    targets.push({ key: norm(n.title), url: newsUrl });
    for (const f of n.attachments ?? []) targets.push({ key: norm(f.fileName), url: newsUrl });
  }

  const usable = targets.filter((t) => t.key.length >= 3);

  return (citation: string): string | undefined => {
    const cite = norm(citation.replace(/^\[|\]$/g, '').replace(/^\s*(?:source|bron)\s*:\s*/i, ''));
    const baseName = citationBase(citation);
    if (!baseName) return undefined;

    // 1. the citation contains a document title (longest title wins; a tie between different documents is not linked)
    const contained = usable.filter((t) => cite.includes(t.key));
    if (contained.length > 0) {
      const longest = Math.max(...contained.map((t) => t.key.length));
      const best = contained.filter((t) => t.key.length === longest);
      if (new Set(best.map((t) => t.url)).size === 1) return best[0].url;
      return undefined;
    }
    // 2. the citation is a shortened title ("Lecture 3" for "Lecture 3 - Introduction"): only when it is unambiguous
    if (baseName.length >= 4) {
      const starts = usable.filter((t) => t.key === baseName || t.key.startsWith(`${baseName} `));
      if (new Set(starts.map((t) => t.url)).size === 1) return starts[0].url;
    }
    // 3. a whole section ("Grades & Feedback", "Calendar events")
    for (const sec of SECTIONS) {
      if (sec.words.some((w) => baseName === w || baseName.startsWith(`${w} `))) return `${base}${sec.path(ou)}`;
    }
    return undefined;
  };
}

/** The Brightspace pages a source can open (standard D2L paths). */
export function d2lUrls(origin: string, orgUnitId: string) {
  const base = origin.replace(/\/+$/, '');
  const ou = orgUnitId;
  return {
    topic: (topicId: string) => `${base}/d2l/le/content/${ou}/viewContent/${topicId}/View`,
    contentHome: `${base}/d2l/le/content/${ou}/Home`,
    assignment: (id: string) =>
      `${base}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${encodeURIComponent(id)}&grpid=0&isprv=0&bp=0&ou=${ou}`,
    assignments: `${base}/d2l/lms/dropbox/user/folders_list.d2l?ou=${ou}`,
    quiz: (id: string) => `${base}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${encodeURIComponent(id)}&ou=${ou}`,
    quizzes: `${base}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${ou}`,
    news: `${base}/d2l/lms/news/main.d2l?ou=${ou}`,
    grades: `${base}/d2l/lms/grades/my_grades/main.d2l?ou=${ou}`,
    calendar: `${base}/d2l/le/calendar/${ou}`,
    discussions: `${base}/d2l/le/${ou}/discussions/List`,
    home: `${base}/d2l/home/${ou}`,
  };
}
