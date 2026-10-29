/**
 * Brightspace Data Models & D2L Valence API Interface Contracts
 */

// 1. Detection & Valence Versions
export interface OrgUnitDetection {
  orgUnitId: string | null;
  source: 'path' | 'query' | 'manual' | null;
}

export interface D2LVersionMap {
  le: string;
  lp: string;
}

export interface ValenceVersionInfo {
  ProductCode: string;
  LatestVersion: string;
  SupportedVersions: string[];
}

// 2. Enrolled Courses
export interface EnrolledCourse {
  orgUnitId: string;
  name: string;
  code: string;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  /** False when Brightspace says the student cannot open the course (Access.CanAccess). */
  canAccess?: boolean;
  /** Org unit type (Brightspace: 3 / "Course Offering" is a course; others are the organisation, semesters, groups...). */
  typeId?: number;
  typeName?: string;
}

export interface D2LMyEnrollmentItem {
  OrgUnit: {
    Id: number | string;
    Name: string;
    Code: string;
    Type: {
      Id: number;
      Code: string;
      Name: string;
    };
  };
  Access: {
    IsActive: boolean;
    CanAccess?: boolean;
    StartDate?: string;
    EndDate?: string;
  };
}

// 3. Course Overview
export interface CourseOverview {
  title: string;
  htmlContent: string;
  textDescription: string;
}

export interface D2LOverviewResponse {
  Title?: string;
  Html?: string;
  Text?: string;
}

// 4. Table of Contents & Topics
export interface TocTopic {
  topicId: string;
  title: string;
  type: 'file' | 'link' | 'html' | 'unknown';
  fileExtension?: 'pdf' | 'pptx' | 'docx' | 'html' | string;
  url?: string;
  downloadUrl?: string;
  parsedContent?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  isHidden?: boolean;
}

/** A downloadable attachment (assignment file, feedback file, news attachment). */
export interface FileRef {
  fileId: string;
  fileName: string;
  size?: number;
  downloadUrl: string;
}

export interface TocModule {
  moduleId: string;
  title: string;
  description?: string;
  subModules: TocModule[];
  topics: TocTopic[];
}

export interface D2LTocTopic {
  TopicId: number | string;
  Identifier?: string;
  TypeIdentifier?: string;
  Title: string;
  Url?: string;
  ActivityType?: number;
}

export interface D2LTocModule {
  ModuleId: number | string;
  Title: string;
  Description?: {
    Html?: string;
    Text?: string;
  };
  Modules?: D2LTocModule[];
  Topics?: D2LTocTopic[];
}

export interface D2LTocResponse {
  Modules: D2LTocModule[];
  Topics?: D2LTocTopic[];
}

// 5. Announcements / Course News
export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  postedDate: string;
  attachments?: FileRef[];
}

export interface D2LNewsItem {
  Id: number | string;
  Title: string;
  Body: {
    Html?: string;
    Text?: string;
  };
  StartDate: string;
}

// 6. Assignments / Dropbox Folders
export interface AssignmentFolder {
  id: string;
  name: string;
  instructions: string;
  dueDate?: string;
  rubricSummary?: string;
  startDate?: string;
  endDate?: string;
  maxScore?: number;
  attachments?: FileRef[];
  submissions?: AssignmentSubmission[];
  feedback?: AssignmentFeedback;
}

export interface AssignmentSubmission {
  status?: string;
  submittedAt?: string;
  comment?: string;
  fileNames?: string[];
}

export interface RubricCriterionResult {
  criterion?: string;
  level?: string;
  score?: string;
  feedback?: string;
}

export interface RubricAssessmentResult {
  rubric?: string;
  overallScore?: string;
  overallLevel?: string;
  criteria: RubricCriterionResult[];
  /** Trimmed raw JSON kept when the response shape was not recognised. */
  raw?: string;
}

export interface AssignmentFeedback {
  score?: number;
  outOf?: number;
  displayedGrade?: string;
  isGraded?: boolean;
  feedbackText?: string;
  rubricAssessments?: RubricAssessmentResult[];
  files?: FileRef[];
}

export interface D2LDropboxFolder {
  Id: number | string;
  Name: string;
  CustomInstructions?: {
    Html?: string;
    Text?: string;
  };
  DueDate?: string;
}

// 7. Quizzes & Exams
export interface QuizItem {
  id: string;
  title: string;
  dueDate?: string;
  attemptsAllowed?: number;
  description?: string;
  instructions?: string;
  timeLimitMinutes?: number;
  attempts?: QuizAttempt[];
}

export interface QuizAttempt {
  attemptNumber?: number;
  completedAt?: string;
  score?: number;
  outOf?: number;
}

export interface D2LQuizItem {
  QuizId: number | string;
  Name: string;
  DueDate?: string;
  AttemptsAllowed?: number;
}

// 8. Calendar Events
export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
}

export interface D2LCalendarEvent {
  CalendarEventId: number | string;
  Title: string;
  Description?: string;
  StartDateTime: string;
  EndDateTime?: string;
}

// 9. Grades & Instructor Feedback
export interface GradeItem {
  id: string;
  name: string;
  pointsNumerator?: number;
  pointsDenominator?: number;
  gradeText?: string;
  comments?: string;
  weight?: number;
  weightedNumerator?: number;
  weightedDenominator?: number;
  maxPoints?: number;
}

export interface FinalGrade {
  displayedGrade?: string;
  pointsNumerator?: number;
  pointsDenominator?: number;
}

export interface InstructorInfo {
  name: string;
  role: string;
  email?: string;
}

export interface DiscussionPost {
  author?: string;
  mine?: boolean;
  date?: string;
  subject?: string;
  body: string;
}

export interface DiscussionThread {
  forum: string;
  topic: string;
  description?: string;
  posts: DiscussionPost[];
}

export interface D2LMyGradeValue {
  GradeObjectId: number | string;
  GradeObjectName: string;
  PointsNumerator?: number;
  PointsDenominator?: number;
  DisplayedGrade?: string;
  Comments?: {
    Html?: string;
    Text?: string;
  };
}

// 10. Aggregated Course Data & Collector Types
export interface CourseData {
  orgUnitId: string;
  courseName: string;
  fetchedAt: number;
  /** Bumped when collectors gain new data, so older IndexedDB caches are refetched. */
  schemaVersion?: number;
  overview?: CourseOverview;
  toc?: TocModule[];
  announcements?: AnnouncementItem[];
  assignments?: AssignmentFolder[];
  quizzes?: QuizItem[];
  calendar?: CalendarEvent[];
  grades?: GradeItem[];
  finalGrade?: FinalGrade;
  instructors?: InstructorInfo[];
  discussions?: DiscussionThread[];
  domFallbackText?: string;
  errors?: Record<string, string>;
  /** Non-fatal failures of the optional enrichment calls (feedback, attempts, discussions, ...). */
  extraErrors?: Record<string, string>;
}

export interface CollectorResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  endpoint: string;
}

// 11. IndexedDB Storage Schemas
export interface StoredCourse {
  orgUnitId: string;
  data: CourseData;
  updatedAt: number;
}

export interface StoredFile {
  id: string;
  orgUnitId: string;
  topicId: string;
  filename: string;
  fileType: string;
  content: string;
  parsedAt: number;
}

// 12. Parsed Document Model
export type { ParsedDocument } from './parser';

export const COURSE_DATA_SCHEMA_VERSION = 2;
