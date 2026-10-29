import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  collectCourseData,
  stripHtml,
  detectTopicType,
  extractDomFallbackText,
  ValenceClientInterface,
} from '@/services/brightspace/collectors';

describe('Brightspace Collectors & Resilient Orchestration', () => {
  let mockClient: ValenceClientInterface;

  const mockOverview = {
    Title: 'CS101 Overview',
    Body: { Html: '<p>Welcome to Computer Science 101!</p>', Text: 'Welcome to Computer Science 101!' },
  };

  const mockToc = {
    Modules: [
      {
        ModuleId: 101,
        Title: 'Module 1: Foundations',
        Description: { Html: '<p>Foundational concepts</p>' },
        Modules: [
          {
            ModuleId: 102,
            Title: 'Submodule 1.1: History',
            Modules: [],
            Topics: [
              {
                TopicId: 201,
                Title: 'History of Computing.pdf',
                TypeIdentifier: 'File',
                Url: '/content/enforced/88421/history.pdf',
              },
            ],
          },
        ],
        Topics: [
          {
            TopicId: 202,
            Title: 'Lecture 1 Slides.pptx',
            TypeIdentifier: 'File',
            Url: '/content/enforced/88421/lecture1.pptx',
          },
          {
            TopicId: 203,
            Title: 'Syllabus Page.html',
            TypeIdentifier: 'Html',
            Url: '/content/enforced/88421/syllabus.html',
          },
        ],
      },
    ],
  };

  const mockNews = [
    {
      Id: 301,
      Title: 'First Class Announcement',
      Body: { Html: '<p>Don’t forget your laptop on Monday.</p>' },
      StartDate: '2026-09-01T08:00:00.000Z',
    },
  ];

  const mockDropbox = [
    {
      Id: 401,
      Name: 'Assignment 1: Algorithms',
      CustomInstructions: { Html: '<p>Implement binary search.</p>' },
      DueDate: '2026-09-15T23:59:00.000Z',
      Assessment: {
        Rubrics: [{ Name: 'Code Correctness' }],
      },
    },
  ];

  const mockQuizzes = [
    {
      QuizId: 501,
      Name: 'Quiz 1: Big-O Notation',
      DueDate: '2026-09-20T23:59:00.000Z',
      AttemptsAllowed: 2,
    },
  ];

  const mockCalendar = [
    {
      CalendarEventId: 601,
      Title: 'Midterm Exam Review',
      Description: 'Live Q&A session in Room 101',
      StartDateTime: '2026-10-10T14:00:00.000Z',
      EndDateTime: '2026-10-10T16:00:00.000Z',
    },
  ];

  const mockGrades = [
    {
      GradeObjectIdentifier: '701',
      GradeObjectName: 'Assignment 1',
      PointsNumerator: 95,
      PointsDenominator: 100,
      GradeText: '95%',
      Comments: { Text: 'Excellent work!' },
    },
  ];

  beforeEach(() => {
    mockClient = {
      getVersions: vi.fn().mockResolvedValue({ le: '1.74', lp: '1.45' }),
      get: vi.fn().mockImplementation((path: string) => {
        if (path.includes('/overview')) return Promise.resolve(mockOverview);
        if (path.includes('/content/toc')) return Promise.resolve(mockToc);
        if (path.includes('/news/')) return Promise.resolve(mockNews);
        if (path.includes('/dropbox/folders/')) return Promise.resolve(mockDropbox);
        if (path.includes('/quizzes/')) return Promise.resolve(mockQuizzes);
        if (path.includes('/calendar/events/')) return Promise.resolve(mockCalendar);
        if (path.includes('/grades/values/myGradeValues/')) return Promise.resolve(mockGrades);
        return Promise.reject(new Error(`Unknown path: ${path}`));
      }),
    };
  });

  it('1. performs full parallel collection across all 8 endpoints when all succeed', async () => {
    const courseData = await collectCourseData('88421', {
      valenceClient: mockClient,
      courseName: 'CS101',
      skipDom: true,
    });

    expect(courseData.orgUnitId).toBe('88421');
    expect(courseData.courseName).toBe('CS101');
    expect(courseData.overview?.title).toBe('CS101 Overview');
    expect(courseData.toc).toHaveLength(1);
    expect(courseData.toc![0].title).toBe('Module 1: Foundations');
    expect(courseData.toc![0].subModules).toHaveLength(1);
    expect(courseData.announcements).toHaveLength(1);
    expect(courseData.announcements![0].title).toBe('First Class Announcement');
    expect(courseData.assignments).toHaveLength(1);
    expect(courseData.assignments![0].rubricSummary).toBe('Code Correctness');
    expect(courseData.quizzes).toHaveLength(1);
    expect(courseData.quizzes![0].title).toBe('Quiz 1: Big-O Notation');
    expect(courseData.calendar).toHaveLength(1);
    expect(courseData.calendar![0].title).toBe('Midterm Exam Review');
    expect(courseData.grades).toHaveLength(1);
    expect(courseData.grades![0].pointsNumerator).toBe(95);
    expect(courseData.errors).toBeUndefined();
  });

  it('2. gracefully handles partial failure when Grades returns HTTP 403 Forbidden', async () => {
    mockClient.get = vi.fn().mockImplementation((path: string) => {
      if (path.includes('/grades/values/myGradeValues/')) {
        const error: any = new Error('Forbidden');
        error.status = 403;
        return Promise.reject(error);
      }
      if (path.includes('/overview')) return Promise.resolve(mockOverview);
      if (path.includes('/content/toc')) return Promise.resolve(mockToc);
      if (path.includes('/news/')) return Promise.resolve(mockNews);
      if (path.includes('/dropbox/folders/')) return Promise.resolve(mockDropbox);
      if (path.includes('/quizzes/')) return Promise.resolve(mockQuizzes);
      if (path.includes('/calendar/events/')) return Promise.resolve(mockCalendar);
      return Promise.reject(new Error('Unknown'));
    });

    const courseData = await collectCourseData('88421', {
      valenceClient: mockClient,
      skipDom: true,
    });

    expect(courseData.grades).toBeUndefined();
    expect(courseData.errors).toBeDefined();
    expect(courseData.errors!.grades).toContain('403');
    // Ensure other 7 sources remain intact
    expect(courseData.overview).toBeDefined();
    expect(courseData.toc).toHaveLength(1);
    expect(courseData.announcements).toHaveLength(1);
    expect(courseData.assignments).toHaveLength(1);
    expect(courseData.quizzes).toHaveLength(1);
    expect(courseData.calendar).toHaveLength(1);
  });

  it('3. gracefully handles multiple partial failures (404 on Quizzes and 500 on Assignments)', async () => {
    mockClient.get = vi.fn().mockImplementation((path: string) => {
      if (path.includes('/quizzes/')) {
        const err: any = new Error('Not Found');
        err.status = 404;
        return Promise.reject(err);
      }
      if (path.includes('/dropbox/folders/')) {
        return Promise.reject(new Error('Internal Server Error 500'));
      }
      if (path.includes('/overview')) return Promise.resolve(mockOverview);
      if (path.includes('/content/toc')) return Promise.resolve(mockToc);
      if (path.includes('/news/')) return Promise.resolve(mockNews);
      if (path.includes('/calendar/events/')) return Promise.resolve(mockCalendar);
      if (path.includes('/grades/values/myGradeValues/')) return Promise.resolve(mockGrades);
      return Promise.reject(new Error('Unknown'));
    });

    const courseData = await collectCourseData('88421', {
      valenceClient: mockClient,
      skipDom: true,
    });

    expect(courseData.quizzes).toBeUndefined();
    expect(courseData.assignments).toBeUndefined();
    expect(courseData.errors!.quizzes).toContain('Not Found');
    expect(courseData.errors!.assignments).toContain('Internal Server Error');
    expect(courseData.overview).toBeDefined();
    expect(courseData.grades).toHaveLength(1);
  });

  it('4. falls back to default API versions if version discovery fails', async () => {
    mockClient.getVersions = vi.fn().mockRejectedValue(new Error('Network error discovering versions'));

    const courseData = await collectCourseData('88421', {
      valenceClient: mockClient,
      skipDom: true,
    });

    expect(courseData.errors?.versions).toContain('Version discovery failed');
    // Verify endpoints were called with default le version '1.74'
    expect(mockClient.get).toHaveBeenCalledWith('/d2l/api/le/1.74/88421/overview');
    expect(courseData.overview?.title).toBe('CS101 Overview');
  });

  it('5. properly detects topic types and extensions during TOC normalization', () => {
    expect(detectTopicType({ Url: 'lecture.pdf' })).toEqual({ type: 'file', fileExtension: 'pdf' });
    expect(detectTopicType({ Url: 'slides.pptx' })).toEqual({ type: 'file', fileExtension: 'pptx' });
    expect(detectTopicType({ Url: 'doc.docx' })).toEqual({ type: 'file', fileExtension: 'docx' });
    expect(detectTopicType({ Url: 'page.html' })).toEqual({ type: 'html', fileExtension: 'html' });
    expect(detectTopicType({ Url: 'https://example.com' })).toEqual({ type: 'link' });
    expect(detectTopicType({ TypeIdentifier: 'File' })).toEqual({ type: 'file' });
  });

  it('6. safely strips HTML and formats text cleanly', () => {
    const dirty = '<p>Hello <b>World</b>!</p><script>alert("hack")</script><style>.body{}</style>';
    const clean = stripHtml(dirty);
    expect(clean).toBe('Hello World!');
    expect(clean).not.toContain('alert');
    expect(clean).not.toContain('.body');
  });

  it('7. extracts clean text from DOM fallback', () => {
    document.body.innerHTML = `
      <header><nav>Navigation links</nav></header>
      <main id="content">
        <h1>Course Title</h1>
        <p>This is the core lecture page content.</p>
        <script>console.log("secret");</script>
      </main>
      <footer>Footer info</footer>
    `;

    const domText = extractDomFallbackText();
    expect(domText).toContain('Course Title');
    expect(domText).toContain('This is the core lecture page content.');
    expect(domText).not.toContain('Navigation links');
    expect(domText).not.toContain('secret');
  });

  it('8. handles total endpoint outage without uncaught exceptions', async () => {
    mockClient.get = vi.fn().mockRejectedValue(new Error('Server completely down'));

    const courseData = await collectCourseData('88421', {
      valenceClient: mockClient,
      skipDom: true,
    });

    expect(courseData.orgUnitId).toBe('88421');
    expect(courseData.overview).toBeUndefined();
    expect(courseData.toc).toBeUndefined();
    expect(courseData.announcements).toBeUndefined();
    expect(courseData.assignments).toBeUndefined();
    expect(courseData.quizzes).toBeUndefined();
    expect(courseData.calendar).toBeUndefined();
    expect(courseData.grades).toBeUndefined();
    expect(Object.keys(courseData.errors || {}).length).toBeGreaterThanOrEqual(7);
  });
});
