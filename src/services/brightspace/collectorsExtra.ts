/**
 * src/services/brightspace/collectorsExtra.ts
 * Optional enrichment on top of the 8 base collectors: assignment feedback & submissions,
 * quiz details/attempts, grade weights/final grade/comments, instructors and discussions.
 * Every call is best-effort: permissions differ per institution, so failures are recorded, never thrown.
 */

import {
  AssignmentFeedback,
  AssignmentSubmission,
  CourseData,
  DiscussionThread,
  FileRef,
  FinalGrade,
  InstructorInfo,
  QuizAttempt,
  RubricAssessmentResult,
} from '@/types/brightspace';

interface Getter {
  get<T>(path: string): Promise<T>;
}

const MAX_RAW_JSON = 2000;
const MAX_DISCUSSION_TOPICS = 15;
const MAX_POSTS_PER_TOPIC = 25;
const MAX_POST_CHARS = 1500;
const MAX_GRADE_DETAIL_CALLS = 40;
const INSTRUCTOR_ROLE = /instructor|teacher|docent|lecturer|professor|coordinator|assistant|tutor|\bta\b|examinator|begeleider/i;

const isObj = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: any): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: any): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : String(v);

function strip(html: string): string {
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

/** Reads D2L RichText ({Text, Html} or {Content, Type}) or a plain string as plain text. */
export function richText(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return strip(v);
  if (isObj(v)) {
    const text = v.Text ?? v.Content;
    if (typeof text === 'string' && text.trim()) return v.Type === 'Html' ? strip(text) : text.trim();
    if (typeof v.Html === 'string') return strip(v.Html);
  }
  return '';
}

/** Normalises D2L attachment arrays ([{FileId, FileName, Size}]) into FileRefs. */
export function toFileRefs(raw: any, urlFor: (fileId: string) => string): FileRef[] {
  if (!Array.isArray(raw)) return [];
  const out: FileRef[] = [];
  for (const f of raw) {
    if (!isObj(f)) continue;
    const fileId = str(f.FileId ?? f.Id);
    if (!fileId) continue;
    out.push({
      fileId,
      fileName: str(f.FileName ?? f.Name) ?? `file-${fileId}`,
      size: num(f.Size),
      downloadUrl: urlFor(fileId),
    });
  }
  return out;
}

/** Reads every page of a D2L list endpoint ({PagingInfo:{Bookmark,HasMoreItems}, Items}) or a plain array. */
export async function getAllPages(client: Getter, path: string, maxPages = 20): Promise<any[]> {
  const all: any[] = [];
  let next = path;
  for (let page = 0; page < maxPages; page++) {
    const raw = await client.get<any>(next);
    const items = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.Items)
        ? raw.Items
        : Array.isArray(raw?.Objects)
          ? raw.Objects
          : [];
    all.push(...items);
    const paging = isObj(raw) ? raw.PagingInfo : undefined;
    if (paging?.HasMoreItems && paging.Bookmark) {
      next = `${path}${path.includes('?') ? '&' : '?'}bookmark=${encodeURIComponent(paging.Bookmark)}`;
    } else {
      break;
    }
  }
  return all;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) await fn(queue.shift()!);
    })
  );
}

function limitJson(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, MAX_RAW_JSON);
  } catch {
    return '';
  }
}

function parseRubricAssessments(raw: any): RubricAssessmentResult[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.filter(isObj).map((r) => {
    const criteriaRaw = r.CriteriaOutcome ?? r.Criteria ?? r.CriterionOutcomes ?? r.CriteriaOutcomes;
    const criteria = Array.isArray(criteriaRaw)
      ? criteriaRaw.filter(isObj).map((c) => ({
          criterion: str(c.CriterionName ?? c.Name ?? c.CriterionId),
          level: str(c.LevelName ?? c.Level?.Name ?? c.LevelId),
          score: str(c.Score ?? c.Points),
          feedback: richText(c.Feedback) || undefined,
        }))
      : [];
    const result: RubricAssessmentResult = {
      rubric: str(r.Name ?? r.RubricName ?? r.Rubric?.Name),
      overallScore: str(r.OverallScore ?? r.Score),
      overallLevel: str(r.OverallLevelName ?? r.OverallLevel?.Name ?? r.OverallLevel),
      criteria,
    };
    if (criteria.length === 0 && !result.overallScore) result.raw = limitJson(r);
    return result;
  });
}

function parseFeedback(raw: any, filesUrl: (fileId: string) => string): AssignmentFeedback | undefined {
  if (!isObj(raw)) return undefined;
  const fb: AssignmentFeedback = {};
  const score = num(raw.Score);
  if (score !== undefined) fb.score = score;
  const outOf = num(raw.OutOf ?? raw.ScoreDenominator);
  if (outOf !== undefined) fb.outOf = outOf;
  if (raw.IsGraded !== undefined) fb.isGraded = Boolean(raw.IsGraded);
  const displayed = str(raw.GradedSymbol ?? raw.DisplayedGrade);
  if (displayed) fb.displayedGrade = displayed;
  const text = richText(raw.Feedback);
  if (text) fb.feedbackText = text;
  const rubrics = parseRubricAssessments(raw.RubricAssessments);
  if (rubrics) fb.rubricAssessments = rubrics;
  const files = toFileRefs(raw.Files, filesUrl);
  if (files.length > 0) fb.files = files;
  return Object.keys(fb).length > 0 ? fb : undefined;
}

function parseSubmissions(raw: any, myId?: string): AssignmentSubmission[] | undefined {
  const entries = Array.isArray(raw) ? raw : isObj(raw) ? [raw] : [];
  const mine = entries.filter(isObj).filter((e) => !myId || !e.Entity || String(e.Entity.EntityId) === myId);
  const out: AssignmentSubmission[] = [];
  for (const e of mine) {
    const status = str(e.Status);
    const subs = Array.isArray(e.Submissions) ? e.Submissions.filter(isObj) : [];
    if (subs.length === 0 && status) out.push({ status });
    for (const sub of subs) {
      out.push({
        status,
        submittedAt: str(sub.SubmissionDate),
        comment: richText(sub.Comment) || undefined,
        fileNames: Array.isArray(sub.Files)
          ? sub.Files.filter(isObj).map((f: any) => String(f.FileName ?? f.Name ?? f.FileId))
          : undefined,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

export async function collectExtras(
  client: Getter,
  orgUnitId: string,
  le: string,
  lp: string,
  data: CourseData
): Promise<void> {
  const errors: Record<string, string> = {};
  const note = (key: string, err: any) => {
    errors[key] = err?.message || String(err);
  };

  let myId: string | undefined;
  try {
    const who = await client.get<any>(`/d2l/api/lp/${lp}/users/whoami`);
    if (isObj(who) && who.Identifier !== undefined) myId = String(who.Identifier);
  } catch (err) {
    note('whoami', err);
  }

  const base = `/d2l/api/le/${le}/${orgUnitId}`;

  const tasks: Array<Promise<void>> = [];

  // 1. Assignment feedback + own submissions
  if (data.assignments?.length) {
    tasks.push(
      mapLimit(data.assignments, 4, async (a) => {
        if (!a.id) return;
        if (myId) {
          try {
            const raw = await client.get<any>(`${base}/dropbox/folders/${a.id}/feedback/User/${myId}`);
            const fb = parseFeedback(
              raw,
              (fileId) => `${base}/dropbox/folders/${a.id}/feedback/User/${myId}/attachments/${fileId}`
            );
            if (fb) a.feedback = fb;
          } catch (err: any) {
            if (!/404|Not found/i.test(err?.message || '')) note(`feedback:${a.name}`, err);
          }
        }
        try {
          const raw = await client.get<any>(`${base}/dropbox/folders/${a.id}/submissions/`);
          const subs = parseSubmissions(raw, myId);
          if (subs) a.submissions = subs;
        } catch (err: any) {
          // students are often not allowed to list submissions; ignore quietly
          if (!/403|Forbidden|404|Not found/i.test(err?.message || '')) note(`submissions:${a.name}`, err);
        }
      }).catch((err) => note('assignments', err))
    );
  }

  // 2. Quiz details + own attempts
  if (data.quizzes?.length) {
    tasks.push(
      mapLimit(data.quizzes, 4, async (q) => {
        if (!q.id) return;
        try {
          const raw = await client.get<any>(`${base}/quizzes/${q.id}`);
          if (isObj(raw)) {
            const description = richText(raw.Description);
            const instructions = richText(raw.Instructions);
            if (description) q.description = description;
            if (instructions) q.instructions = instructions;
            const limit = num(raw.TimeLimit?.TimeLimitValue ?? raw.TimeLimit);
            if (limit && raw.TimeLimit?.IsEnforced !== false) q.timeLimitMinutes = limit;
          }
        } catch (err) {
          note(`quiz:${q.title}`, err);
        }
        try {
          const items = await getAllPages(client, `${base}/quizzes/${q.id}/attempts/`);
          const attempts: QuizAttempt[] = items
            .filter(isObj)
            .filter((a) => !myId || a.UserId === undefined || String(a.UserId) === myId)
            .map((a) => ({
              attemptNumber: num(a.AttemptNumber),
              completedAt: str(a.TimeCompleted),
              score: num(a.Score),
              outOf: num(a.PossibleScore ?? a.OutOf),
            }));
          if (attempts.length > 0) q.attempts = attempts;
        } catch (err: any) {
          if (!/403|Forbidden|404|Not found/i.test(err?.message || '')) note(`attempts:${q.title}`, err);
        }
      }).catch((err) => note('quizzes', err))
    );
  }

  // 3. Grade weights, comments and final grade
  tasks.push(
    (async () => {
      try {
        const defs = await getAllPages(client, `${base}/grades/`);
        const byId = new Map(defs.filter(isObj).map((d) => [String(d.Id), d]));
        for (const g of data.grades ?? []) {
          const def = byId.get(g.id);
          if (!def) continue;
          const weight = num(def.Weight);
          if (weight !== undefined) g.weight = weight;
          const max = num(def.MaxPoints);
          if (max !== undefined) g.maxPoints = max;
        }
      } catch (err) {
        note('gradeDefinitions', err);
      }

      if (myId && data.grades?.length) {
        const candidates = data.grades.filter((g) => !g.comments && g.id).slice(0, MAX_GRADE_DETAIL_CALLS);
        await mapLimit(candidates, 4, async (g) => {
          try {
            const raw = await client.get<any>(`${base}/grades/${g.id}/values/${myId}`);
            if (isObj(raw)) {
              const comment = richText(raw.Comments);
              if (comment) g.comments = comment;
            }
          } catch {
            // comments unavailable for this item
          }
        });
      }

      if (myId) {
        try {
          const raw = await client.get<any>(`${base}/grades/final/values/${myId}`);
          if (isObj(raw)) {
            const fg: FinalGrade = {
              displayedGrade: str(raw.DisplayedGrade),
              pointsNumerator: num(raw.PointsNumerator),
              pointsDenominator: num(raw.PointsDenominator),
            };
            if (fg.displayedGrade || fg.pointsNumerator !== undefined) data.finalGrade = fg;
          }
        } catch {
          // final grade not released
        }
      }
    })()
  );

  // 4. Instructors / teaching staff
  tasks.push(
    (async () => {
      try {
        const items = await getAllPages(client, `/d2l/api/lp/${lp}/enrollments/orgUnits/${orgUnitId}/users/`, 10);
        const staff: InstructorInfo[] = [];
        for (const it of items) {
          if (!isObj(it)) continue;
          const role = str(it.Role?.Name);
          const name = str(it.User?.DisplayName);
          if (!role || !name || !INSTRUCTOR_ROLE.test(role)) continue;
          staff.push({ name, role, email: str(it.User?.EmailAddress) });
          if (staff.length >= 25) break;
        }
        if (staff.length > 0) data.instructors = staff;
      } catch (err: any) {
        if (!/403|Forbidden|404|Not found/i.test(err?.message || '')) note('instructors', err);
      }
    })()
  );

  // 5. Discussions (capped)
  tasks.push(
    (async () => {
      try {
        const forumsRaw = await client.get<any>(`${base}/discussions/forums/`);
        const forums = Array.isArray(forumsRaw) ? forumsRaw.filter(isObj) : [];
        const threads: DiscussionThread[] = [];
        let topicBudget = MAX_DISCUSSION_TOPICS;
        for (const forum of forums) {
          if (topicBudget <= 0) break;
          const forumId = str(forum.ForumId);
          if (!forumId) continue;
          const topicsRaw = await client.get<any>(`${base}/discussions/forums/${forumId}/topics/`);
          const topics = Array.isArray(topicsRaw) ? topicsRaw.filter(isObj) : [];
          for (const topic of topics) {
            if (topicBudget <= 0) break;
            const topicId = str(topic.TopicId);
            if (!topicId) continue;
            topicBudget--;
            const thread: DiscussionThread = {
              forum: str(forum.Name) ?? `Forum ${forumId}`,
              topic: str(topic.Name) ?? `Topic ${topicId}`,
              description: richText(topic.Description) || undefined,
              posts: [],
            };
            try {
              const posts = await getAllPages(
                client,
                `${base}/discussions/forums/${forumId}/topics/${topicId}/posts/`,
                3
              );
              for (const p of posts.filter(isObj).filter((x) => !x.IsDeleted).slice(0, MAX_POSTS_PER_TOPIC)) {
                const body = richText(p.Message).slice(0, MAX_POST_CHARS);
                if (!body) continue;
                thread.posts.push({
                  author: str(p.PostingUserDisplayName ?? p.PostingUserId),
                  mine: myId !== undefined && String(p.PostingUserId) === myId,
                  date: str(p.DatePosted),
                  subject: str(p.Subject),
                  body,
                });
              }
            } catch (err) {
              note(`posts:${thread.topic}`, err);
            }
            if (thread.posts.length > 0 || thread.description) threads.push(thread);
          }
        }
        if (threads.length > 0) data.discussions = threads;
      } catch (err: any) {
        if (!/403|Forbidden|404|Not found/i.test(err?.message || '')) note('discussions', err);
      }
    })()
  );

  await Promise.all(tasks);
  if (Object.keys(errors).length > 0) data.extraErrors = errors;
}
