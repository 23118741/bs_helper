/**
 * src/services/context/describeStats.ts
 * Human-readable summary of what the relevance filter sent for one answer (shown as a tooltip).
 */

import type { RelevanceStats } from '@/types/parser';

export function describeStats(stats: RelevanceStats | undefined): string | undefined {
  if (!stats || stats.totalDocuments + (stats.sectionsOmitted?.length ?? 0) === 0) return undefined;
  const parts: string[] = [];
  if (stats.totalDocuments > 0) {
    parts.push(`Searched ${stats.includedDocuments} of ${stats.totalDocuments} documents`);
    if (stats.totalChunks && stats.includedChunks !== undefined && stats.includedChunks < stats.totalChunks) {
      parts.push(`${stats.includedChunks} of ${stats.totalChunks} slides/pages/sections`);
    }
  }
  if (stats.sectionsOmitted && stats.sectionsOmitted.length > 0) {
    parts.push(`skipped: ${stats.sectionsOmitted.join(', ')}`);
  }
  return parts.join(' · ');
}
