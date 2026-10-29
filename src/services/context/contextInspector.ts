/**
 * src/services/context/contextInspector.ts
 * Reports, per selected TOC topic, whether its content actually made it into the LLM context.
 */

import { CourseData, TocModule } from '@/types/brightspace';
import { ContextSelection, ParsedDocument } from '@/types/parser';
import { buildContextBundle } from './contextSerializer';

export interface TopicInspection {
  topicId: string;
  title: string;
  modulePath: string;
  kind: string;
  included: boolean;
  chars: number;
  reason: string;
}

export function inspectContext(
  courseData: CourseData,
  selection: ContextSelection,
  parsedDocs?: ParsedDocument[] | Record<string, ParsedDocument> | Map<string, ParsedDocument>
): TopicInspection[] {
  const bundle = buildContextBundle(courseData, selection, parsedDocs);
  const included = new Map(bundle.documents.map((d) => [d.topicId, d]));
  const rows: TopicInspection[] = [];

  const walk = (modules: TocModule[], path: string[], ancestors: string[]) => {
    for (const mod of modules) {
      const p = [...path, mod.title];
      const ids = [...ancestors, mod.moduleId];
      for (const t of mod.topics) {
        const selected =
          selection.selectedTopicIds.includes(t.topicId) ||
          ids.some((id) => selection.selectedModuleIds.includes(id));
        if (!selected) continue;
        const doc = included.get(t.topicId);
        const kind = t.fileExtension || t.type;
        let reason = 'content in context';
        if (!doc) {
          reason =
            t.type === 'link'
              ? 'external link: only a URL, never fetched'
              : 'no parsed content: download/parse failed, unsupported, or still loading';
        }
        rows.push({
          topicId: t.topicId,
          title: t.title,
          modulePath: p.join(' > '),
          kind,
          included: Boolean(doc),
          chars: doc?.content.length ?? 0,
          reason,
        });
      }
      if (mod.subModules?.length) walk(mod.subModules, p, ids);
    }
  };
  if (courseData.toc) walk(courseData.toc, [], []);

  // The student's own files (only the switched-on ones are in the context)
  if (selection.includeUserFiles !== false) {
    const list = Array.isArray(parsedDocs) ? parsedDocs : parsedDocs instanceof Map ? [...parsedDocs.values()] : Object.values(parsedDocs ?? {});
    const seen = new Set<string>();
    for (const d of list) {
      if (!d.topicId?.startsWith('user:') || seen.has(d.topicId)) continue;
      seen.add(d.topicId);
      const doc = included.get(d.topicId);
      rows.push({
        topicId: d.topicId,
        title: d.filename,
        modulePath: d.metadata?.userPath ? `My files > ${d.metadata.userPath.split('/').join(' > ')}` : 'My files',
        kind: String(d.fileType),
        included: Boolean(doc),
        chars: doc?.content.length ?? 0,
        reason: doc ? 'content in context' : 'no text available',
      });
    }
  }
  return rows;
}
