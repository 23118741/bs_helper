/**
 * src/services/context/sourceRegistry.ts
 * Every citeable source in a request gets a stable ID, shown in double brackets in the context headings
 * ("### [[D123]] Week 1 > Lecture 3"). The model cites that ID ("[[D123 Slide 14]]"); the label, the link and the
 * reason a source has no link all come from this registry, never from text the model wrote. Built on the client
 * from the bundle that is sent; nothing about it is stored on the server.
 *
 * IDs are derived from the Brightspace ids (not from order), so they stay valid in the conversation history when the
 * context is filtered differently on the next question.
 */

import type {
  AnnouncementItem,
  AssignmentFolder,
  DiscussionThread,
  QuizItem,
} from '@/types/brightspace';
import type { BundledDocument, CourseContextBundle } from '@/types/parser';
import { d2lUrls } from '@/services/brightspace/sourceLinks';

export type SourceKind = 'document' | 'attachment' | 'assignment' | 'quiz' | 'announcement' | 'discussion' | 'section' | 'user-file';

export interface SourceEntry {
  id: string;
  /** Shown to the student instead of the ID. */
  label: string;
  kind: SourceKind;
  /** Where the source opens in Brightspace; absent when there is no page for it. */
  url?: string;
  /** Tooltip for a source without a link. */
  reason?: string;
}

export type SourceRegistry = Record<string, SourceEntry>;

/** Fixed IDs for whole sections of the course. */
export const SECTION_ID = {
  overview: 'OVERVIEW',
  outline: 'OUTLINE',
  staff: 'STAFF',
  news: 'NEWS',
  calendar: 'CAL',
  grades: 'GRADES',
  discussions: 'DISC',
} as const;

/** Short, stable hash for ids that are not numbers (file names, user files, forum topics). */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase().slice(0, 6);
}

const safe = (s: string): string => (/^[A-Za-z0-9]{1,16}$/.test(s) ? s : hash(s));

export function docSourceId(doc: BundledDocument): string {
  const t = doc.topicId ?? '';
  if (t.startsWith('user:')) return `U${hash(t)}`;
  if (t.startsWith('att:')) return `F${hash(t)}`;
  return `D${t ? safe(t) : hash(doc.title)}`;
}
export const assignmentSourceId = (a: AssignmentFolder): string => `A${safe(String(a.id))}`;
export const quizSourceId = (q: QuizItem): string => `Q${safe(String(q.id))}`;
export const announcementSourceId = (n: AnnouncementItem): string => `N${safe(String(n.id))}`;
export const threadSourceId = (t: DiscussionThread): string => `T${hash(`${t.forum}>${t.topic}`)}`;

/** "[[D123]]" for a heading; empty when the id is empty. */
export const tag = (id: string): string => (id ? `[[${id}]]` : '');

export function buildSourceRegistry(bundle: CourseContextBundle, origin?: string): SourceRegistry {
  const reg: SourceRegistry = {};
  const ou = bundle.courseInfo?.orgUnitId ?? '';
  const urls = origin && ou && ou !== 'unknown' ? d2lUrls(origin, ou) : undefined;
  const add = (e: SourceEntry) => {
    reg[e.id] = e;
  };
  const noPage = 'There is no page for this in Brightspace';

  if (bundle.overview) add({ id: SECTION_ID.overview, label: 'Course overview', kind: 'section', url: urls?.home, reason: urls ? undefined : noPage });
  if (bundle.outline) add({ id: SECTION_ID.outline, label: 'Course structure', kind: 'section', url: urls?.contentHome, reason: urls ? undefined : noPage });
  if (bundle.instructors?.length) add({ id: SECTION_ID.staff, label: 'Teaching staff', kind: 'section', reason: 'The class list is not linked' });
  if (bundle.announcements?.length) {
    add({ id: SECTION_ID.news, label: 'Announcements', kind: 'section', url: urls?.news, reason: urls ? undefined : noPage });
    for (const n of bundle.announcements) add({ id: announcementSourceId(n), label: n.title, kind: 'announcement', url: urls?.news, reason: urls ? undefined : noPage });
  }
  if (bundle.calendar?.length) add({ id: SECTION_ID.calendar, label: 'Calendar', kind: 'section', url: urls?.calendar, reason: urls ? undefined : noPage });
  if (bundle.grades?.length) add({ id: SECTION_ID.grades, label: 'Grades', kind: 'section', url: urls?.grades, reason: urls ? undefined : noPage });
  if (bundle.discussions?.length) {
    add({ id: SECTION_ID.discussions, label: 'Discussions', kind: 'section', url: urls?.discussions, reason: urls ? undefined : noPage });
    for (const t of bundle.discussions) add({ id: threadSourceId(t), label: `${t.forum} > ${t.topic}`, kind: 'discussion', url: urls?.discussions, reason: urls ? undefined : noPage });
  }
  for (const a of bundle.assignments ?? []) {
    add({ id: assignmentSourceId(a), label: a.name, kind: 'assignment', url: urls?.assignment(String(a.id)), reason: urls ? undefined : noPage });
  }
  for (const q of bundle.quizzes ?? []) {
    add({ id: quizSourceId(q), label: q.title, kind: 'quiz', url: urls?.quiz(String(q.id)), reason: urls ? undefined : noPage });
  }

  for (const d of bundle.documents ?? []) {
    const id = docSourceId(d);
    const t = d.topicId ?? '';
    if (t.startsWith('user:')) {
      add({ id, label: d.title, kind: 'user-file', reason: 'Your own file: it is not in Brightspace' });
    } else if (t.startsWith('att:')) {
      // an attachment opens on the page of the assignment or announcement it belongs to
      const [, kind, owner] = t.split(':');
      const url = !urls ? undefined : kind === 'news' ? urls.news : urls.assignment(owner);
      add({ id, label: d.title, kind: 'attachment', url, reason: url ? undefined : noPage });
    } else {
      const url = urls && /^\d+$/.test(t) ? urls.topic(t) : undefined;
      add({ id, label: d.title, kind: 'document', url, reason: url ? undefined : noPage });
    }
  }
  return reg;
}
