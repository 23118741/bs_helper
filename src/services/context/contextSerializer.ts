/**
 * src/services/context/contextSerializer.ts
 * Formats user-selected course data and parsed documents into:
 * 1. Source-attributed Markdown document (.md)
 * 2. Structured JSON bundle matching CourseContextBundle (.json)
 */

import { NOT_FOUND_MARKER } from '../../../shared/prompts';
import { AssignmentFolder, CourseData, TocModule } from '@/types/brightspace';
import {
  BundledDocument,
  ContextSelection,
  CourseContextBundle,
  ParsedDocument,
  SerializedOutput,
  createFullContextSelection,
} from '@/types/parser';
import {
  announcementSourceId,
  assignmentSourceId,
  docSourceId,
  quizSourceId,
  SECTION_ID,
  tag,
  threadSourceId,
} from './sourceRegistry';

/**
 * Strips HTML tags, scripts, styles, and unescapes common HTML entities for plain text / markdown context.
 */
export function cleanHtmlText(html?: string): string {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Assembles a structured CourseContextBundle from CourseData, selection criteria, and parsed docs.
 */
export function buildContextBundle(
  courseData: CourseData,
  selection?: ContextSelection,
  parsedDocs?: ParsedDocument[] | Record<string, ParsedDocument> | Map<string, ParsedDocument>
): CourseContextBundle {
  const activeSelection = selection ?? createFullContextSelection(courseData);

  // Normalize parsed documents map
  const docMap = new Map<string, ParsedDocument>();
  if (parsedDocs) {
    if (Array.isArray(parsedDocs)) {
      for (const d of parsedDocs) {
        if (d.topicId) docMap.set(d.topicId, d);
        if (d.filename) docMap.set(d.filename, d);
      }
    } else if (parsedDocs instanceof Map) {
      for (const [k, v] of parsedDocs.entries()) {
        docMap.set(k, v);
      }
    } else {
      for (const [k, v] of Object.entries(parsedDocs)) {
        docMap.set(k, v);
      }
    }
  }

  // Course info
  const courseInfo = {
    orgUnitId: courseData.orgUnitId || 'unknown',
    courseName: courseData.courseName || 'Brightspace Course',
    exportedAt: new Date().toISOString(),
  };

  // Overview
  let overview: string | undefined = undefined;
  if (activeSelection.includeOverview && courseData.overview) {
    const raw =
      courseData.overview.textDescription || cleanHtmlText(courseData.overview.htmlContent);
    if (raw && raw.trim().length > 0) {
      overview = raw.trim();
    }
  }

  // Announcements
  const announcements =
    activeSelection.includeAnnouncements &&
    courseData.announcements &&
    courseData.announcements.length > 0
      ? courseData.announcements.map((a) => ({
          ...a,
          body: cleanHtmlText(a.body),
        }))
      : undefined;

  // Assignments
  const assignments =
    activeSelection.includeAssignments &&
    courseData.assignments &&
    courseData.assignments.length > 0
      ? courseData.assignments.map((a) => ({
          ...a,
          instructions: cleanHtmlText(a.instructions),
        }))
      : undefined;

  // Quizzes
  const quizzes =
    activeSelection.includeQuizzes && courseData.quizzes && courseData.quizzes.length > 0
      ? courseData.quizzes
      : undefined;

  // Calendar
  const calendar =
    activeSelection.includeCalendar && courseData.calendar && courseData.calendar.length > 0
      ? courseData.calendar.map((c) => ({
          ...c,
          description: c.description ? cleanHtmlText(c.description) : undefined,
        }))
      : undefined;

  // Grades
  const grades =
    activeSelection.includeGrades && courseData.grades && courseData.grades.length > 0
      ? courseData.grades.map((g) => ({
          ...g,
          comments: g.comments ? cleanHtmlText(g.comments) : undefined,
        }))
      : undefined;

  // Traverse TOC and collect selected documents
  const documents: BundledDocument[] = [];
  const processedTopicIds = new Set<string>();
  const allTocTopicIds = new Set<string>();

  const isTopicSelected = (topicId: string, ancestorModuleIds: string[]): boolean => {
    if (activeSelection.selectedTopicIds.includes(topicId)) return true;
    for (const modId of ancestorModuleIds) {
      if (activeSelection.selectedModuleIds.includes(modId)) return true;
    }
    return false;
  };

  const processModules = (modules: TocModule[], pathStack: string[], idStack: string[]) => {
    for (const mod of modules) {
      const currentPath = [...pathStack, mod.title];
      const currentIds = [...idStack, mod.moduleId];

      // Track all known topics in TOC
      for (const topic of mod.topics) {
        allTocTopicIds.add(topic.topicId);
        allTocTopicIds.add(topic.title);
      }

      // Process submodules in hierarchy
      if (mod.subModules && mod.subModules.length > 0) {
        processModules(mod.subModules, currentPath, currentIds);
      }

      for (const topic of mod.topics) {
        if (!isTopicSelected(topic.topicId, currentIds)) continue;

        processedTopicIds.add(topic.topicId);
        processedTopicIds.add(topic.title);

        // Extract content: priority to parsedContent on topic, then docMap
        let content = topic.parsedContent || '';
        let fileType = topic.fileExtension || 'unknown';

        if (!content && (docMap.has(topic.topicId) || docMap.has(topic.title))) {
          const doc = docMap.get(topic.topicId) || docMap.get(topic.title);
          if (doc) {
            content = doc.extractedText;
            fileType = doc.fileType;
          }
        }

        if (content && content.trim().length > 0) {
          documents.push({
            title: topic.title,
            type: fileType,
            content: content.trim(),
            topicId: topic.topicId,
            modulePath: currentPath.join(' > '),
          });
        }
      }
    }
  };

  if (courseData.toc) {
    processModules(courseData.toc, [], []);
  }

  // Course outline (structure, descriptions, dates) so the model knows about topics without file content
  let outline: string | undefined;
  if (activeSelection.includeStructure !== false && courseData.toc && courseData.toc.length > 0) {
    const lines: string[] = [];
    const walkOutline = (modules: TocModule[], depth: number, ancestorSelected: boolean) => {
      for (const mod of modules) {
        const modSelected = ancestorSelected || activeSelection.selectedModuleIds.includes(mod.moduleId);
        const visibleTopics = mod.topics.filter((t) => modSelected || activeSelection.selectedTopicIds.includes(t.topicId));
        const indent = '  '.repeat(depth);
        if (modSelected || visibleTopics.length > 0) {
          lines.push(`${indent}- **${mod.title}**${mod.description ? ` — ${mod.description}` : ''}`);
          for (const t of visibleTopics) {
            const meta: string[] = [t.fileExtension || t.type];
            if (t.startDate) meta.push(`from ${t.startDate}`);
            if (t.dueDate) meta.push(`due ${t.dueDate}`);
            else if (t.endDate) meta.push(`until ${t.endDate}`);
            if (t.isHidden) meta.push('hidden');
            lines.push(`${indent}  - ${t.title} (${meta.join(', ')})${t.description ? ` — ${t.description}` : ''}`);
          }
        }
        if (mod.subModules?.length) walkOutline(mod.subModules, depth + 1, modSelected);
      }
    };
    walkOutline(courseData.toc, 0, false);
    if (lines.length > 0) outline = lines.join('\n');
  }

  // Attachments (assignment files, feedback files, announcement files) downloaded by the document loader
  const attachmentDocs = new Map<string, ParsedDocument>();
  for (const doc of docMap.values()) {
    if (doc.topicId?.startsWith('att:')) attachmentDocs.set(doc.topicId, doc);
  }
  for (const doc of attachmentDocs.values()) {
    const [, kind, ownerId] = doc.topicId.split(':');
    let modulePath: string | undefined;
    if (kind === 'assignment' || kind === 'feedback') {
      if (!activeSelection.includeAssignments) continue;
      const a = courseData.assignments?.find((x) => x.id === ownerId);
      modulePath = `Assignments > ${a?.name ?? ownerId}${kind === 'feedback' ? ' > Instructor feedback file' : ' > Attachment'}`;
    } else if (kind === 'news') {
      if (!activeSelection.includeAnnouncements) continue;
      const n = courseData.announcements?.find((x) => x.id === ownerId);
      modulePath = `Announcements > ${n?.title ?? ownerId} > Attachment`;
    } else {
      continue;
    }
    if (!doc.extractedText.trim()) continue;
    documents.push({
      title: doc.filename,
      type: doc.fileType,
      content: doc.extractedText.trim(),
      topicId: doc.topicId,
      modulePath,
    });
  }

  // Files the student added themselves (Context → My files)
  if (activeSelection.includeUserFiles !== false) {
    const seenUser = new Set<string>();
    for (const doc of docMap.values()) {
      if (!doc.topicId?.startsWith('user:') || seenUser.has(doc.topicId)) continue;
      seenUser.add(doc.topicId);
      if (doc.metadata?.userDisabled || !doc.extractedText.trim()) continue;
      documents.push({
        title: doc.filename,
        type: doc.fileType,
        content: doc.extractedText.trim(),
        topicId: doc.topicId,
        modulePath: doc.metadata?.userPath ? `My files > ${doc.metadata.userPath.split('/').join(' > ')}` : 'My files',
      });
    }
  }

  // Handle standalone parsed documents not part of TOC
  const hasDocumentSelection =
    activeSelection.selectedModuleIds.length > 0 || activeSelection.selectedTopicIds.length > 0;

  if (hasDocumentSelection || (!courseData.toc && !selection)) {
    for (const [key, doc] of docMap.entries()) {
      if (doc.topicId?.startsWith('att:') || doc.topicId?.startsWith('user:')) continue;
      if (doc.topicId && (processedTopicIds.has(doc.topicId) || allTocTopicIds.has(doc.topicId)))
        continue;
      if (doc.filename && (processedTopicIds.has(doc.filename) || allTocTopicIds.has(doc.filename)))
        continue;

      const isExplicitlySelected =
        (!courseData.toc && !selection) ||
        (doc.topicId && activeSelection.selectedTopicIds.includes(doc.topicId)) ||
        (doc.filename && activeSelection.selectedTopicIds.includes(doc.filename));

      if (isExplicitlySelected) {
        if (doc.topicId) processedTopicIds.add(doc.topicId);
        if (doc.filename) processedTopicIds.add(doc.filename);
        processedTopicIds.add(key);

        documents.push({
          title: doc.filename,
          type: doc.fileType,
          content: doc.extractedText.trim(),
          topicId: doc.topicId,
          modulePath: 'Additional Course Materials',
        });
      }
    }
  }

  const instructors =
    activeSelection.includeInstructors !== false && courseData.instructors?.length
      ? courseData.instructors
      : undefined;
  const discussions =
    activeSelection.includeDiscussions !== false && courseData.discussions?.length
      ? courseData.discussions
      : undefined;
  const finalGrade = activeSelection.includeGrades ? courseData.finalGrade : undefined;

  return {
    courseInfo,
    overview,
    outline,
    instructors,
    announcements,
    assignments,
    quizzes,
    calendar,
    grades,
    finalGrade,
    discussions,
    documents,
  };
}

function renderAssignmentExtras(a: AssignmentFolder): string {
  let out = '';
  if (a.startDate || a.endDate) out += `\n- **Available:** ${a.startDate ?? '?'} to ${a.endDate ?? '?'}`;
  if (a.maxScore !== undefined) out += `\n- **Max score:** ${a.maxScore}`;
  if (a.attachments?.length) out += `\n- **Attachments:** ${a.attachments.map((f) => f.fileName).join(', ')}`;
  if (a.submissions?.length) {
    out += `\n- **My submission(s):**`;
    for (const s of a.submissions) {
      const parts = [s.status, s.submittedAt && `submitted ${s.submittedAt}`, s.fileNames?.length && `files: ${s.fileNames.join(', ')}`, s.comment && `comment: ${s.comment}`].filter(Boolean);
      out += `\n  - ${parts.join(' · ')}`;
    }
  }
  const fb = a.feedback;
  if (fb) {
    out += `\n- **Instructor feedback & grade:**`;
    if (fb.score !== undefined) out += `\n  - Score: ${fb.score}${fb.outOf !== undefined ? ` / ${fb.outOf}` : a.maxScore !== undefined ? ` / ${a.maxScore}` : ''}`;
    if (fb.displayedGrade) out += `\n  - Grade: ${fb.displayedGrade}`;
    if (fb.isGraded === false) out += `\n  - Not graded yet`;
    if (fb.feedbackText) out += `\n  - Feedback: ${fb.feedbackText}`;
    for (const r of fb.rubricAssessments ?? []) {
      out += `\n  - Rubric${r.rubric ? ` "${r.rubric}"` : ''}${r.overallScore ? `: ${r.overallScore}` : ''}${r.overallLevel ? ` (${r.overallLevel})` : ''}`;
      for (const c of r.criteria) {
        out += `\n    - ${[c.criterion, c.level, c.score && `score ${c.score}`, c.feedback].filter(Boolean).join(' — ')}`;
      }
      if (r.raw) out += `\n    - (raw) ${r.raw}`;
    }
    if (fb.files?.length) out += `\n  - Feedback files: ${fb.files.map((f) => f.fileName).join(', ')}`;
  }
  return out;
}

/**
 * Serializes a CourseContextBundle into an LLM-ready, source-attributed Markdown document.
 */
export function serializeToMarkdown(bundle: CourseContextBundle): string {
  const sections: string[] = [];

  // 1. Header Banner
  sections.push(
    `# Course Context: ${bundle.courseInfo.courseName} (${bundle.courseInfo.orgUnitId})\n_Exported: ${bundle.courseInfo.exportedAt}_\n`
  );

  let hasContent = false;

  // 2. Course Overview
  if (bundle.overview && bundle.overview.trim().length > 0) {
    hasContent = true;
    sections.push(
      `### Course Overview ${tag(SECTION_ID.overview)}\n> **Source:** Brightspace Course Overview (\`/d2l/api/le/{version}/${bundle.courseInfo.orgUnitId}/overview\`)\n\n${bundle.overview.trim()}`
    );
  }

  if (bundle.outline) {
    hasContent = true;
    sections.push(
      `### Course Structure ${tag(SECTION_ID.outline)}\n> **Source:** Brightspace Content (table of contents): modules, topics, dates and descriptions. Topic content appears further below when it could be read.\n\n${bundle.outline}`
    );
  }

  if (bundle.instructors && bundle.instructors.length > 0) {
    hasContent = true;
    const rows = bundle.instructors
      .map((i) => `- **${i.name}** (${i.role})${i.email ? ` — ${i.email}` : ''}`)
      .join('\n');
    sections.push(`### Teaching Staff ${tag(SECTION_ID.staff)}\n> **Source:** Brightspace Classlist (instructor roles only)\n\n${rows}`);
  }

  // 3. Announcements
  if (bundle.announcements && bundle.announcements.length > 0) {
    hasContent = true;
    const items = bundle.announcements
      .map(
        (a) =>
          `#### ${a.title} ${tag(announcementSourceId(a))}\n_Posted: ${a.postedDate}_\n\n${a.body}` +
          (a.attachments?.length ? `\n\n_Attachments: ${a.attachments.map((f) => f.fileName).join(', ')}_` : '')
      )
      .join('\n\n---\n\n');

    sections.push(
      `### Announcements ${tag(SECTION_ID.news)}\n> **Source:** Brightspace Course News & Announcements (\`/d2l/api/le/{version}/${bundle.courseInfo.orgUnitId}/news/\`)\n\n${items}`
    );
  }

  // 4. Module Topics & Documents (### Module > Topic [Slide N])
  if (bundle.documents && bundle.documents.length > 0) {
    hasContent = true;
    const docSections: string[] = [];

    for (const doc of bundle.documents) {
      const id = tag(docSourceId(doc));
      const modulePrefix = doc.modulePath ? `${doc.modulePath} > ` : '';
      const docTitle = doc.title;
      const content = doc.content;

      // Only part of the document was sent: say so, and give the outline of the whole document
      if (doc.partial) {
        docSections.push(
          `### ${modulePrefix}${docTitle} (partial: ${doc.partial.sent} of ${doc.partial.total}) ${id}` +
            (doc.partial.outline ? `\n> Outline of the whole document: ${doc.partial.outline}` : '')
        );
      }

      // Check if document has PPTX [Slide N] blocks
      const slideRegex = /(?:^|\n)\[Slide\s+(\d+)\]([\s\S]*?)(?=(?:\n\[Slide\s+\d+\]|$))/g;
      const slideMatches = Array.from(content.matchAll(slideRegex));

      if (slideMatches.length > 0) {
        for (const match of slideMatches) {
          const slideNumber = match[1];
          const slideBody = match[2].trim();
          docSections.push(
            `### ${modulePrefix}${docTitle} [Slide ${slideNumber}] ${id}\n> **Source:** Presentation Slide: ${docTitle} (Slide ${slideNumber})\n\n${slideBody}`
          );
        }
        continue;
      }

      // Check if document has PDF [Page N] blocks
      const pageRegex = /(?:^|\n)\[Page\s+(\d+)\]([\s\S]*?)(?=(?:\n\[Page\s+\d+\]|$))/g;
      const pageMatches = Array.from(content.matchAll(pageRegex));

      if (pageMatches.length > 0) {
        for (const match of pageMatches) {
          const pageNumber = match[1];
          const pageBody = match[2].trim();
          docSections.push(
            `### ${modulePrefix}${docTitle} [Page ${pageNumber}] ${id}\n> **Source:** Document Page: ${docTitle} (Page ${pageNumber})\n\n${pageBody}`
          );
        }
        continue;
      }

      // Default document rendering (DOCX, HTML, plain notes)
      docSections.push(
        `### ${modulePrefix}${docTitle} ${id}\n> **Source:** Course Document: ${docTitle} (${doc.type})\n\n${content}`
      );
    }

    if (docSections.length > 0) {
      sections.push(docSections.join('\n\n'));
    }
  }

  {
    const lines: string[] = [];
    for (const d of bundle.omittedDocuments ?? []) {
      lines.push(`- Document: ${d.modulePath ? `${d.modulePath} > ` : ''}${d.title} (~${d.tokens.toLocaleString()} tokens)`);
    }
    for (const d of bundle.documents ?? []) {
      if (d.partial) lines.push(`- Document only partly sent: ${d.title}: sent ${d.partial.sent} of ${d.partial.total}`);
    }
    for (const sct of bundle.omittedSections ?? []) {
      lines.push(`- Section ${sct.section}: ${sct.summary}`);
    }
    if (lines.length > 0) {
      sections.push(
        `### Not Included In This Request\n> This course material exists but was left out to save space. It is NOT visible to you. ` +
          `If the question could be answered by one of these and you cannot answer from the visible text, reply with exactly: ` +
          `${NOT_FOUND_MARKER} so that more material can be searched. Do not guess.\n\n${lines.join('\n')}`
      );
    }
  }

  // 5. Assignments & Deadlines
  const hasAssignments = bundle.assignments && bundle.assignments.length > 0;
  const hasCalendar = bundle.calendar && bundle.calendar.length > 0;
  const hasQuizzes = bundle.quizzes && bundle.quizzes.length > 0;

  if (hasAssignments || hasCalendar || hasQuizzes) {
    hasContent = true;
    const subSections: string[] = [];

    if (hasAssignments) {
      const items = bundle.assignments!
        .map((a) => {
          let str = `#### ${a.name} ${tag(assignmentSourceId(a))}\n- **Due Date:** ${a.dueDate || 'No due date specified'}\n- **Instructions:** ${a.instructions || 'None'}`;
          if (a.rubricSummary) {
            str += `\n- **Rubric:** ${a.rubricSummary}`;
          }
          str += renderAssignmentExtras(a);
          return str;
        })
        .join('\n\n');
      subSections.push(items);
    }

    if (hasCalendar) {
      const calItems = bundle
        .calendar!.map(
          (c) =>
            `- **${c.title}** (${c.startDate}${c.endDate ? ` to ${c.endDate}` : ''})${c.description ? `: ${c.description}` : ''}`
        )
        .join('\n');
      subSections.push(`#### Upcoming Calendar Deadlines & Events ${tag(SECTION_ID.calendar)}\n${calItems}`);
    }

    if (hasQuizzes) {
      const quizItems = bundle
        .quizzes!.map((q) => {
          let line = `- **${q.title}** ${tag(quizSourceId(q))} (Due: ${q.dueDate || 'N/A'}${q.attemptsAllowed !== undefined ? `, Attempts: ${q.attemptsAllowed}` : ''}${q.timeLimitMinutes ? `, Time limit: ${q.timeLimitMinutes} min` : ''})`;
          if (q.description) line += `\n  - Description: ${q.description}`;
          if (q.instructions) line += `\n  - Instructions: ${q.instructions}`;
          for (const at of q.attempts ?? []) {
            line += `\n  - My attempt${at.attemptNumber !== undefined ? ` ${at.attemptNumber}` : ''}: ${at.score ?? '?'}${at.outOf !== undefined ? ` / ${at.outOf}` : ''}${at.completedAt ? ` (completed ${at.completedAt})` : ''}`;
          }
          return line;
        })
        .join('\n');
      subSections.push(`#### Quizzes & Assessments\n${quizItems}`);
    }

    sections.push(
      `### Assignments & Deadlines\n> **Source:** Brightspace Assignments (\`/dropbox/folders/\`) & Calendar Events (\`/calendar/events/\`)\n\n${subSections.join('\n\n')}`
    );
  }

  // 6. Grades & Feedback
  if (bundle.grades && bundle.grades.length > 0) {
    hasContent = true;
    const gradeItems = bundle.grades
      .map((g) => {
        const scoreStr =
          g.pointsNumerator !== undefined && g.pointsDenominator !== undefined
            ? `${g.pointsNumerator} / ${g.pointsDenominator}`
            : 'N/A';
        const displayGrade = g.gradeText ? ` (${g.gradeText})` : '';
        const weightStr =
          g.weight !== undefined
            ? `\n- **Weight:** ${g.weight}%`
            : g.weightedNumerator !== undefined && g.weightedDenominator !== undefined
              ? `\n- **Weighted:** ${g.weightedNumerator} / ${g.weightedDenominator}`
              : '';
        return `#### ${g.name}\n- **Score:** ${scoreStr}${displayGrade}${weightStr}\n- **Feedback:** ${g.comments || 'No comments provided.'}`;
      })
      .join('\n\n');
    const finalLine = bundle.finalGrade
      ? `**Final grade:** ${bundle.finalGrade.displayedGrade ?? ''}${bundle.finalGrade.pointsNumerator !== undefined ? ` (${bundle.finalGrade.pointsNumerator} / ${bundle.finalGrade.pointsDenominator ?? '?'})` : ''}\n\n`
      : '';

    sections.push(
      `### Grades & Feedback ${tag(SECTION_ID.grades)}\n> **Source:** Brightspace Grades (\`/grades/values/myGradeValues/\`)\n\n${finalLine}${gradeItems}`
    );
  }

  if (bundle.discussions && bundle.discussions.length > 0) {
    hasContent = true;
    const threads = bundle.discussions
      .map((t) => {
        const posts = t.posts
          .map((p) => `- **${p.mine ? 'Me' : p.author ?? 'Unknown'}**${p.date ? ` (${p.date})` : ''}${p.subject ? ` — ${p.subject}` : ''}: ${p.body}`)
          .join('\n');
        return `#### ${t.forum} > ${t.topic} ${tag(threadSourceId(t))}${t.description ? `\n_${t.description}_` : ''}\n\n${posts}`;
      })
      .join('\n\n');
    sections.push(`### Discussions ${tag(SECTION_ID.discussions)}\n> **Source:** Brightspace Discussion Forums (capped)\n\n${threads}`);
  }

  // Degraded / Empty selection fallback
  if (!hasContent) {
    sections.push('_No course items selected._');
  }

  return sections.join('\n\n');
}

/**
 * Serializes a CourseContextBundle into formatted JSON string.
 */
export function serializeToJson(bundle: CourseContextBundle, pretty: boolean = true): string {
  return JSON.stringify(bundle, null, pretty ? 2 : 0);
}

/**
 * Unified context serialization entry point:
 * Takes CourseData, ContextSelection, and parsed docs and produces both Markdown and JSON output.
 */
export function serializeContext(
  courseData: CourseData,
  selection?: ContextSelection,
  parsedDocs?: ParsedDocument[] | Record<string, ParsedDocument> | Map<string, ParsedDocument>
): SerializedOutput {
  const jsonBundle = buildContextBundle(courseData, selection, parsedDocs);
  const markdown = serializeToMarkdown(jsonBundle);
  return {
    markdown,
    jsonBundle,
  };
}
