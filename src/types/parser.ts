/**
 * src/types/parser.ts
 * In-Browser Document Parsers, Context Selection, and Serialized Bundles Contracts
 */

import {
  AnnouncementItem,
  AssignmentFolder,
  CalendarEvent,
  CourseData,
  DiscussionThread,
  FinalGrade,
  GradeItem,
  InstructorInfo,
  QuizItem,
} from './brightspace';


export type SupportedFileType = 'pdf' | 'pptx' | 'docx' | 'html' | 'txt' | 'unknown';

export interface ParseOptions {
  /** Topic ID in Brightspace TOC */
  topicId?: string;
  /** File name with extension */
  filename?: string;
  /** MIME type if available */
  mimeType?: string;
  /** Maximum number of pages or slides to extract */
  maxPages?: number;
  /** Whether to extract speaker notes from PPTX (default: true) */
  includeSpeakerNotes?: boolean;
  /** Whether to format slide tables as Markdown tables (default: true) */
  includeTables?: boolean;
  /** Whether to clean / normalize whitespace and formatting (default: true) */
  cleanFormatting?: boolean;
  /** Optional password for protected documents */
  password?: string;
  /** Execution timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

export type DocumentParserOptions = ParseOptions;

export interface ParsedDocumentMetadata {
  pageCount?: number;
  slideCount?: number;
  hasSpeakerNotes?: boolean;
  paragraphCount?: number;
  tableCount?: number;
  wordCount?: number;
  tokenEstimate?: number;
  extractedAt: number;
  warnings?: string[];
  /** User files only: excluded from the context without being deleted. */
  userDisabled?: boolean;
  /** User files only: the folder the file was added from, e.g. "Thesis/Notes" (empty/undefined = top level). */
  userPath?: string;
}

export interface ParsedDocument {
  topicId: string;
  filename: string;
  fileType: SupportedFileType | string;
  extractedText: string;
  metadata: ParsedDocumentMetadata;
}

export interface ContextSelection {
  includeOverview: boolean;
  selectedModuleIds: string[];
  selectedTopicIds: string[];
  includeAnnouncements: boolean;
  includeAssignments: boolean;
  includeQuizzes: boolean;
  includeCalendar: boolean;
  includeGrades: boolean;
  /** Optional (treated as true when undefined): course outline, instructors, discussions. */
  includeStructure?: boolean;
  includeInstructors?: boolean;
  includeDiscussions?: boolean;
  /** Optional (treated as true when undefined): files the student added themselves. */
  includeUserFiles?: boolean;
}

export interface CourseInfo {
  orgUnitId: string;
  courseName: string;
  exportedAt: string;
}

export interface BundledDocument {
  title: string;
  type: string;
  content: string;
  topicId?: string;
  modulePath?: string;
  /** Always sent with the request, never dropped by the relevance filter (explicit chat attachments). */
  pinned?: boolean;
  /** Set when only some slides/pages/sections of the document were sent. */
  partial?: { sent: string; total: string; outline?: string };
}

export interface CourseContextBundle {
  courseInfo: CourseInfo;
  overview?: string;
  announcements?: AnnouncementItem[];
  assignments?: AssignmentFolder[];
  quizzes?: QuizItem[];
  calendar?: CalendarEvent[];
  grades?: GradeItem[];
  finalGrade?: FinalGrade;
  instructors?: InstructorInfo[];
  discussions?: DiscussionThread[];
  outline?: string;
  documents: BundledDocument[];
  /** Documents left out by the relevance filter (title only), so the model can point the user to them. */
  omittedDocuments?: Array<{ title: string; modulePath?: string; tokens: number }>;
  /** Sections (news, assignments, grades, ...) left out for this question, each with a one-line summary. */
  omittedSections?: Array<{ section: string; summary: string; tokens: number }>;
}

/** What the relevance filter did for one request. */
export interface RelevanceStats {
  totalDocuments: number;
  includedDocuments: number;
  includedTokens: number;
  /** True when the query matched at least one document. */
  matched: boolean;
  /** Score of the best matching slide/page/section (0 = nothing matched). Input of the answer router. */
  bestScore?: number;
  /** How many of the question's words occur in the best matching slide/page, out of how many words it has. */
  bestMatchedTerms?: number;
  queryTermCount?: number;
  /** The question points at a slide or page number. */
  pointsAtPart?: boolean;
  /** The student attached or pinned documents to this question. */
  hasPinned?: boolean;
  /** topicIds of the documents that were sent (used by debug tooling). */
  includedTopicIds: string[];
  /** Slides/pages/sections available in total and sent (chunk-level retrieval). */
  totalChunks?: number;
  includedChunks?: number;
  /** Sections that were left out for this question (e.g. 'announcements'). */
  sectionsOmitted?: string[];
  /** What kind of question this was seen as (fact / explain / summary-doc / broad). */
  queryKind?: string;
  /** True when part of the course material was left out, so a wider search could find more. */
  widenable?: boolean;
}

export interface SerializedOutput {
  markdown: string;
  jsonBundle: CourseContextBundle;
}

export type DocumentParseErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'CORRUPT_FILE'
  | 'EMPTY_FILE'
  | 'PARSE_FAILED';

export class DocumentParseError extends Error {
  readonly code: DocumentParseErrorCode;
  readonly filename?: string;

  constructor(message: string, code: DocumentParseErrorCode, filename?: string) {
    super(message);
    this.name = 'DocumentParseError';
    this.code = code;
    this.filename = filename;
  }
}

/**
 * Creates an empty context selection where all sections and items are deselected.
 */
export function createEmptyContextSelection(): ContextSelection {
  return {
    includeOverview: false,
    selectedModuleIds: [],
    selectedTopicIds: [],
    includeAnnouncements: false,
    includeAssignments: false,
    includeQuizzes: false,
    includeCalendar: false,
    includeGrades: false,
    includeUserFiles: false,
  };
}

/**
 * Creates a full context selection where all available course sections and topics are selected.
 */
export function createFullContextSelection(course?: CourseData): ContextSelection {
  const moduleIds: string[] = [];
  const topicIds: string[] = [];

  if (course?.toc) {
    const collect = (modules: typeof course.toc) => {
      for (const mod of modules) {
        moduleIds.push(mod.moduleId);
        for (const topic of mod.topics) {
          topicIds.push(topic.topicId);
        }
        if (mod.subModules && mod.subModules.length > 0) {
          collect(mod.subModules);
        }
      }
    };
    collect(course.toc);
  }

  return {
    includeOverview: true,
    selectedModuleIds: moduleIds,
    selectedTopicIds: topicIds,
    includeAnnouncements: true,
    includeAssignments: true,
    includeQuizzes: true,
    includeCalendar: true,
    includeGrades: true,
    includeUserFiles: true,
  };
}
