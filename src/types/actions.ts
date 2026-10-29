/**
 * src/types/actions.ts
 * Type definitions for Action Plugin Registry, Presets, and Q&A Chat.
 */

import { ComponentType } from 'react';
import { CourseData } from './brightspace';
import { ContextSelection, ParsedDocument } from './parser';
import { LLMMode } from './llm';
import { CITATION_INSTRUCTION } from '../../shared/prompts';
import { buildKeyTermsPrompt } from '@/services/actions/keyTerms';
import { buildLectureNotesPrompt } from '@/services/actions/studyNotes';

/**
 * Props every action tool receives.
 *
 * Building a new tool? Send the course context like this and you get the relevance filter for free:
 *
 *   const bundle = buildContextBundle(courseData, selection, parsedDocs);
 *   await llm.generate(prompt, { contextBundle: bundle, relevance: { query: userQuestion } });
 *
 * Always pass the context as a `contextBundle` (never serialize it yourself): the gateway then
 * filters the documents per request (see RelevanceOption in types/llm.ts) and reports what it sent in
 * `response.contextStats`. Use `relevance: { mode: 'all' }` for broad summaries.
 * An architecture test forbids serializing the context outside the gateway.
 */
export interface ActionPluginProps {
  courseData: CourseData;
  selection: ContextSelection;
  parsedDocs?: ParsedDocument[] | Record<string, ParsedDocument> | Map<string, ParsedDocument>;
  currentMode: LLMMode;
  onOpenSettings?: () => void;
}

export type ActionPluginStatus = 'active' | 'roadmap';

export interface ActionPlugin {
  id: string;
  name: string;
  title: string;
  icon: string;
  status: ActionPluginStatus;
  description: string;
  badge?: string;
  order: number;
  component: ComponentType<ActionPluginProps>;
}

export type SummaryPresetType =
  | 'complete-briefing'
  | 'study-notes'
  | 'key-terms'
  | 'assignments-deadlines'
  | 'grades-feedback';

export interface SummaryPresetConfig {
  id: SummaryPresetType;
  title: string;
  subtitle: string;
  icon: string;
  description: string;
  /** One sentence shown in the chat as the student's question when the preset is clicked. */
  question: string;
  promptTemplate: (courseName?: string) => string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  mode?: LLMMode;
  tokenEstimate?: number;
  isError?: boolean;
  /** Short description of which documents were sent along (relevance filter). */
  contextInfo?: string;
  /** Names of files attached to this (user) message. */
  attachments?: string[];
  /** Tooltip with what was searched (documents, slides/pages, skipped sections). */
  contextTitle?: string;
  /** Part of the course material was left out, so "Search all materials" could find more. */
  widenable?: boolean;
  /** What to send again for "Search all materials". */
  rerun?: { prompt: string; displayQuery?: string; presetId?: string };
}

export const SUMMARY_PRESETS: SummaryPresetConfig[] = [
  {
    id: 'complete-briefing',
    title: 'Quick Course Guide',
    subtitle: 'Executive overview & expectations',
    icon: 'Sparkles',
    description: 'Generates a complete executive briefing covering syllabus, grading, milestones, and contacts.',
    question: 'Give me a complete briefing of this course.',
    promptTemplate: (courseName = 'this course') =>
      `Provide a complete, executive course briefing for "${courseName}" based strictly on the provided Brightspace materials.\n` +
      `Output requirements: Complete: include every relevant detail the materials contain, no filler, BLUF formatting. Use Markdown tables and bullet points with inline citations.\n` +
      `Structure:\n` +
      `1. Course Identity & Core Learning Objectives (bullet points)\n` +
      `2. Grading Scheme & Weightings (compact Markdown table: Component | Weight | Due Date / Notes)\n` +
      `3. Chronological Milestone Schedule (Deliverables, Quizzes & Exams with exact dates)\n` +
      `4. Instructor & Communication Channels (exact contacts and office hours from syllabus/overview)\n` +
      `If any information is absent from the materials, state strictly "Not specified in the selected Brightspace materials." Do not invent generic advice.` +
      `\n${CITATION_INSTRUCTION}`,
  },
  {
    id: 'study-notes',
    title: 'Study & Lecture Notes',
    subtitle: 'Every lecture, summarized in depth',
    icon: 'BookOpen',
    description: 'Writes extensive study notes per lecture (concepts, examples, key terms, formulas, exam focus), shown lecture by lecture as each one is done.',
    question: 'Make extensive study notes of every lecture in this course.',
    // the chat runs this preset per lecture (services/actions/studyNotes.ts); this prompt is the one-request fallback
    promptTemplate: (courseName = 'this course') => buildLectureNotesPrompt(courseName),
  },
  {
    id: 'key-terms',
    title: 'Key Terms',
    subtitle: 'Definitions as your course teaches them',
    icon: 'ListChecks',
    description: 'Lists key terms with the course\'s own definition, its source and a verbatim quote that is checked against the materials.',
    question: 'Which key terms does this course define, and how?',
    promptTemplate: buildKeyTermsPrompt,
  },
  {
    id: 'assignments-deadlines',
    title: 'Assignments & Deadlines',
    subtitle: 'Deliverables & rubric criteria',
    icon: 'Calendar',
    description: 'Compiles all assignments, instructions, rubrics, and calendar dates into a chronological digest.',
    question: 'Which assignments and deadlines does this course have?',
    promptTemplate: (courseName = 'this course') =>
      `Extract and compile an exhaustive assignments and deadlines digest from "${courseName}" based strictly on the provided materials.\n` +
      `Output requirements: Strict chronological order, complete (every deliverable and every detail the materials give), Markdown tables, zero generic advice.\n` +
      `Structure:\n` +
      `1. Deliverables & Deadlines Timeline (compact Markdown table: Deliverable | Due Date | Category | Weight | Source)\n` +
      `2. Assignment Instructions & Required Formats (bullet points per item, with all requirements)\n` +
      `3. Rubrics & Evaluation Criteria Breakdown (exact criteria from dropbox/syllabus)\n` +
      `4. Quizzes, Exams & Assessment Specifics (dates, formats, attempts allowed)\n` +
      `Do not include generic time management tips or ungrounded preparation schedules.` +
      `\n${CITATION_INSTRUCTION}`,
  },
  {
    id: 'grades-feedback',
    title: 'Grades & Feedback',
    subtitle: 'Academic standing & advice',
    icon: 'Award',
    description: 'Extracts recorded grades, score breakdown, and instructor feedback highlights.',
    question: 'What are my grades and feedback so far?',
    promptTemplate: (courseName = 'this course') =>
      `Analyze the student's actual grades, scores, and instructor feedback available in Brightspace for "${courseName}".\n` +
      `Output requirements: Complete factual extraction, zero generic motivational filler, Markdown tables.\n` +
      `Structure:\n` +
      `1. Academic Standing & Score Breakdown (compact Markdown table: Assessment | Points / Grade | Weight | Feedback)\n` +
      `2. Specific Instructor Feedback & Commendations (exact quotes or summaries from instructor comments)\n` +
      `3. Remaining / Ungraded Course Weightings (calculated strictly from syllabus grading policy)\n` +
      `If no grades or feedback are present in the context, output strictly: "No grades or feedback recorded in the selected Brightspace materials." Do not invent hypothetical scenarios or generic study strategies.` +
      `\n${CITATION_INSTRUCTION}`,
  },
];

