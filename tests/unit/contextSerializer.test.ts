/**
 * tests/unit/contextSerializer.test.ts
 * Comprehensive unit tests for source-attributed Markdown and JSON context serialization
 */

import { describe, it, expect } from 'vitest';
import {
  buildContextBundle,
  serializeToMarkdown,
  serializeToJson,
  serializeContext,
  cleanHtmlText,
} from '@/services/context/contextSerializer';
import { CourseData } from '@/types/brightspace';
import {
  ContextSelection,
  ParsedDocument,
  createEmptyContextSelection,
  createFullContextSelection,
} from '@/types/parser';

describe('Context Serializer Service (contextSerializer.ts)', () => {
  const mockCourseData: CourseData = {
    orgUnitId: '88421',
    courseName: 'CS101: Introduction to Computer Science',
    fetchedAt: 1700000000000,
    overview: {
      title: 'Course Syllabus',
      htmlContent: '<p>Welcome to <b>CS101</b>! This course covers foundations of computing.</p>',
      textDescription: 'Welcome to CS101! This course covers foundations of computing.',
    },
    announcements: [
      {
        id: 'news-1',
        title: 'Welcome to Week 1',
        body: '<p>Please review the course syllabus and setup your development environment.</p>',
        postedDate: '2026-09-01T08:00:00Z',
      },
      {
        id: 'news-2',
        title: 'Office Hours Update',
        body: 'Office hours will be held on Tuesdays via Zoom.',
        postedDate: '2026-09-05T12:00:00Z',
      },
    ],
    toc: [
      {
        moduleId: 'mod-1',
        title: 'Module 1: Foundations',
        subModules: [
          {
            moduleId: 'submod-1',
            title: 'Week 1: Architecture',
            subModules: [],
            topics: [
              {
                topicId: 'top-101',
                title: 'Lecture 1 Slides.pptx',
                type: 'file',
                fileExtension: 'pptx',
              },
            ],
          },
        ],
        topics: [
          {
            topicId: 'top-102',
            title: 'Syllabus.pdf',
            type: 'file',
            fileExtension: 'pdf',
          },
          {
            topicId: 'top-103',
            title: 'Week 1 Reading.docx',
            type: 'file',
            fileExtension: 'docx',
          },
        ],
      },
    ],
    assignments: [
      {
        id: 'assign-1',
        name: 'Homework 1: ALU Design',
        instructions: '<p>Implement a 4-bit ALU in Logisim.</p>',
        dueDate: '2026-09-15T23:59:00Z',
        rubricSummary: 'Completeness (50%), Test Cases (50%)',
      },
    ],
    quizzes: [
      {
        id: 'quiz-1',
        title: 'Quiz 1: Logic Gates',
        dueDate: '2026-09-20T23:59:00Z',
        attemptsAllowed: 2,
      },
    ],
    calendar: [
      {
        id: 'cal-1',
        title: 'Midterm Examination',
        startDate: '2026-10-15T10:00:00Z',
        endDate: '2026-10-15T12:00:00Z',
        description: 'Room 302',
      },
    ],
    grades: [
      {
        id: 'grd-1',
        name: 'Homework 1: ALU Design',
        pointsNumerator: 96,
        pointsDenominator: 100,
        gradeText: '96%',
        comments: 'Excellent documentation and simulation tests.',
      },
    ],
  };

  const mockParsedDocs: ParsedDocument[] = [
    {
      topicId: 'top-101',
      filename: 'Lecture 1 Slides.pptx',
      fileType: 'pptx',
      extractedText:
        '[Slide 1]\n### Introduction\nWelcome to Computer Architecture.\n\n> **Speaker Notes:**\n> Introduce course staff.\n\n[Slide 2]\n### Binary Logic\nEverything is 1s and 0s.\n\n> **Speaker Notes:**\n> Ask students about transistors.',
      metadata: { slideCount: 2, hasSpeakerNotes: true, extractedAt: 1700000000000 },
    },
    {
      topicId: 'top-102',
      filename: 'Syllabus.pdf',
      fileType: 'pdf',
      extractedText:
        '[Page 1]\nCS101 Policies and Grading Scale.\n\n[Page 2]\nAcademic Integrity and Schedule.',
      metadata: { pageCount: 2, extractedAt: 1700000000000 },
    },
    {
      topicId: 'top-103',
      filename: 'Week 1 Reading.docx',
      fileType: 'docx',
      extractedText:
        '# Chapter 1: The Hardware/Software Interface\n\nComputers execute machine instructions.',
      metadata: { wordCount: 8, extractedAt: 1700000000000 },
    },
  ];

  describe('Suite 1: Full Course Serialization (Markdown & JSON)', () => {
    it('produces valid source-attributed markdown containing all 5 required section headers', () => {
      const output = serializeContext(mockCourseData, undefined, mockParsedDocs);

      // Verify 5 required section headers from Dispatch
      expect(output.markdown).toContain('### Course Overview');
      expect(output.markdown).toContain('### Announcements');
      expect(output.markdown).toContain(
        '### Module 1: Foundations > Week 1: Architecture > Lecture 1 Slides.pptx [Slide 1]'
      );
      expect(output.markdown).toContain(
        '### Module 1: Foundations > Week 1: Architecture > Lecture 1 Slides.pptx [Slide 2]'
      );
      expect(output.markdown).toContain('### Assignments & Deadlines');
      expect(output.markdown).toContain('### Grades & Feedback');

      // Verify source attribution blockquotes
      expect(output.markdown).toContain('> **Source:** Brightspace Course Overview');
      expect(output.markdown).toContain('> **Source:** Brightspace Course News & Announcements');
      expect(output.markdown).toContain(
        '> **Source:** Presentation Slide: Lecture 1 Slides.pptx (Slide 1)'
      );
      expect(output.markdown).toContain(
        '> **Source:** Presentation Slide: Lecture 1 Slides.pptx (Slide 2)'
      );
      expect(output.markdown).toContain('> **Source:** Brightspace Assignments');
      expect(output.markdown).toContain('> **Source:** Brightspace Grades');

      // Verify speaker notes preservation
      expect(output.markdown).toContain('> **Speaker Notes:**');
      expect(output.markdown).toContain('Introduce course staff.');
    });

    it('formats PDF pages with [Page N] block attribution', () => {
      const output = serializeContext(mockCourseData, undefined, mockParsedDocs);

      expect(output.markdown).toContain('### Module 1: Foundations > Syllabus.pdf [Page 1]');
      expect(output.markdown).toContain('### Module 1: Foundations > Syllabus.pdf [Page 2]');
      expect(output.markdown).toContain('> **Source:** Document Page: Syllabus.pdf (Page 1)');
      expect(output.markdown).toContain('CS101 Policies and Grading Scale.');
    });

    it('generates a clean structured JSON bundle matching CourseContextBundle', () => {
      const output = serializeContext(mockCourseData, undefined, mockParsedDocs);
      const json = output.jsonBundle;

      expect(json.courseInfo.orgUnitId).toBe('88421');
      expect(json.courseInfo.courseName).toBe('CS101: Introduction to Computer Science');
      expect(json.overview).toContain('Welcome to CS101');
      expect(json.announcements).toHaveLength(2);
      expect(json.assignments).toHaveLength(1);
      expect(json.quizzes).toHaveLength(1);
      expect(json.calendar).toHaveLength(1);
      expect(json.grades).toHaveLength(1);
      expect(json.documents).toHaveLength(3);

      const jsonString = serializeToJson(json);
      const parsed = JSON.parse(jsonString);
      expect(parsed.courseInfo.orgUnitId).toBe('88421');
      expect(parsed.documents[0].title).toBe('Lecture 1 Slides.pptx');
    });
  });

  describe('Suite 2: ContextSelection Filtering (Subsets)', () => {
    it('serializes ONLY announcements when other sections are unselected', () => {
      const selection: ContextSelection = {
        includeOverview: false,
        selectedModuleIds: [],
        selectedTopicIds: [],
        includeAnnouncements: true,
        includeAssignments: false,
        includeQuizzes: false,
        includeCalendar: false,
        includeGrades: false,
      };

      const output = serializeContext(mockCourseData, selection, mockParsedDocs);

      expect(output.markdown).toContain('### Announcements');
      expect(output.markdown).not.toContain('### Course Overview');
      expect(output.markdown).not.toContain('### Assignments & Deadlines');
      expect(output.markdown).not.toContain('### Grades & Feedback');
      expect(output.markdown).not.toContain('[Slide 1]');
      expect(output.jsonBundle.overview).toBeUndefined();
      expect(output.jsonBundle.assignments).toBeUndefined();
      expect(output.jsonBundle.grades).toBeUndefined();
      expect(output.jsonBundle.documents).toHaveLength(0);
      expect(output.jsonBundle.announcements).toHaveLength(2);
    });

    it('filters documents by granular selectedTopicIds', () => {
      const selection: ContextSelection = {
        includeOverview: false,
        selectedModuleIds: [],
        selectedTopicIds: ['top-101'], // only PPTX slide selected
        includeAnnouncements: false,
        includeAssignments: false,
        includeQuizzes: false,
        includeCalendar: false,
        includeGrades: false,
      };

      const output = serializeContext(mockCourseData, selection, mockParsedDocs);

      expect(output.markdown).toContain('Lecture 1 Slides.pptx [Slide 1]');
      expect(output.markdown).not.toContain('Syllabus.pdf');
      expect(output.markdown).not.toContain('Week 1 Reading.docx');
      expect(output.jsonBundle.documents).toHaveLength(1);
      expect(output.jsonBundle.documents[0].topicId).toBe('top-101');
    });

    it('handles empty selection gracefully without throwing or broken headers', () => {
      const selection = createEmptyContextSelection();

      const output = serializeContext(mockCourseData, selection, mockParsedDocs);

      expect(output.markdown).toContain('# Course Context: CS101: Introduction to Computer Science');
      expect(output.markdown).toContain('_No course items selected._');
      expect(output.markdown).not.toContain('###');
      expect(output.jsonBundle.documents).toHaveLength(0);
    });

    it('creates full selection helper that selects all items', () => {
      const full = createFullContextSelection(mockCourseData);
      expect(full.includeOverview).toBe(true);
      expect(full.includeAnnouncements).toBe(true);
      expect(full.selectedModuleIds).toContain('mod-1');
      expect(full.selectedModuleIds).toContain('submod-1');
      expect(full.selectedTopicIds).toContain('top-101');
      expect(full.selectedTopicIds).toContain('top-102');
      expect(full.selectedTopicIds).toContain('top-103');
    });
  });

  describe('Suite 3: Standalone Bundle Serialization & HTML Sanitization', () => {
    it('serializes directly from a standalone CourseContextBundle object', () => {
      const bundle = buildContextBundle(mockCourseData, undefined, mockParsedDocs);
      const markdown = serializeToMarkdown(bundle);
      const jsonStr = serializeToJson(bundle);

      expect(markdown).toContain('### Course Overview');
      expect(markdown).toContain('### Announcements');
      expect(markdown).toContain('### Grades & Feedback');
      expect(JSON.parse(jsonStr)).toEqual(bundle);
    });

    it('sanitizes embedded HTML tags and removes malicious script blocks', () => {
      const dirtyCourse: CourseData = {
        orgUnitId: '999',
        courseName: 'Security 101',
        fetchedAt: Date.now(),
        overview: {
          title: 'Overview',
          htmlContent: '<p>Safe intro</p><script>alert("xss")</script><style>body{color:red}</style>',
          textDescription: '',
        },
        announcements: [
          {
            id: 'x1',
            title: 'Notice',
            body: '<div>Important <b>notice</b> with &amp; entity.</div>',
            postedDate: '2026-10-01',
          },
        ],
      };

      const output = serializeContext(dirtyCourse);

      expect(output.markdown).not.toContain('<script>');
      expect(output.markdown).not.toContain('alert("xss")');
      expect(output.markdown).not.toContain('<style>');
      expect(output.markdown).toContain('Safe intro');
      expect(output.markdown).toContain('Important notice with & entity.');
    });

    it('cleanHtmlText handles empty and undefined strings gracefully', () => {
      expect(cleanHtmlText('')).toBe('');
      expect(cleanHtmlText(undefined)).toBe('');
      expect(cleanHtmlText('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;')).toBe(
        '<b>bold</b> & "quotes"'
      );
    });
  });
});
