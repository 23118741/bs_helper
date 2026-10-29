import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { StorageService } from '@/services/brightspace/storage';
import { CourseData, EnrolledCourse, ParsedDocument } from '@/types/brightspace';

describe('IndexedDB Storage Service', () => {
  let storage: StorageService;

  const sampleCourseData: CourseData = {
    orgUnitId: '88421',
    courseName: 'CS101 Artificial Intelligence',
    fetchedAt: Date.now(),
    overview: {
      title: 'Course Syllabus',
      htmlContent: '<p>Overview</p>',
      textDescription: 'Overview',
    },
    toc: [
      {
        moduleId: '101',
        title: 'Module 1',
        subModules: [],
        topics: [
          {
            topicId: '201',
            title: 'Lecture 1.pdf',
            type: 'file',
            fileExtension: 'pdf',
          },
        ],
      },
    ],
    announcements: [
      {
        id: '301',
        title: 'Welcome',
        body: 'Welcome to CS101',
        postedDate: '2026-09-01',
      },
    ],
  };

  const sampleParsedDoc: ParsedDocument = {
    topicId: '201',
    filename: 'Lecture 1.pdf',
    fileType: 'pdf',
    extractedText: '[Page 1]\n\nIntroduction to AI agents.',
    metadata: {
      pageCount: 1,
      extractedAt: Date.now(),
    },
  };

  beforeEach(async () => {
    storage = new StorageService();
    await storage.clearAllData();
  });

  it('1. saves and retrieves CourseData successfully', async () => {
    await storage.saveCourseData(sampleCourseData);
    const retrieved = await storage.getCourseData('88421');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.orgUnitId).toBe('88421');
    expect(retrieved?.courseName).toBe('CS101 Artificial Intelligence');
    expect(retrieved?.overview?.title).toBe('Course Syllabus');
    expect(retrieved?.toc).toHaveLength(1);
    expect(retrieved?.announcements).toHaveLength(1);
  });

  it('2. overwrites existing CourseData on subsequent saves', async () => {
    await storage.saveCourseData(sampleCourseData);

    const updatedData: CourseData = {
      ...sampleCourseData,
      courseName: 'CS101 Updated Name',
      fetchedAt: Date.now() + 5000,
    };
    await storage.saveCourseData(updatedData);

    const retrieved = await storage.getCourseData('88421');
    expect(retrieved?.courseName).toBe('CS101 Updated Name');
    expect(retrieved?.fetchedAt).toBe(updatedData.fetchedAt);
  });

  it('3. returns null when querying a non-existent course', async () => {
    const nonExistent = await storage.getCourseData('99999');
    expect(nonExistent).toBeNull();
  });

  it('4. deletes CourseData successfully', async () => {
    await storage.saveCourseData(sampleCourseData);
    await storage.deleteCourseData('88421');

    const result = await storage.getCourseData('88421');
    expect(result).toBeNull();
  });

  it('5. saves and retrieves ParsedDocument by topicId', async () => {
    await storage.saveParsedDocument(sampleParsedDoc, '88421', 1024);
    const doc = await storage.getParsedDocument('201');

    expect(doc).not.toBeNull();
    expect(doc?.topicId).toBe('201');
    expect(doc?.filename).toBe('Lecture 1.pdf');
    expect(doc?.fileType).toBe('pdf');
    expect(doc?.extractedText).toContain('Introduction to AI agents.');
  });

  it('6. queries parsed documents by course ID using index', async () => {
    await storage.saveParsedDocument(sampleParsedDoc, '88421', 1024);
    await storage.saveParsedDocument(
      {
        topicId: '202',
        filename: 'Lecture 2.pptx',
        fileType: 'pptx',
        extractedText: '[Slide 1]\n\nNeural Networks.',
        metadata: { slideCount: 5, extractedAt: Date.now() },
      },
      '88421',
      2048
    );
    await storage.saveParsedDocument(
      {
        topicId: '999',
        filename: 'OtherCourse.pdf',
        fileType: 'pdf',
        extractedText: 'Other',
        metadata: { extractedAt: Date.now() },
      },
      '99999',
      512
    );

    const docs = await storage.getParsedDocumentsForCourse('88421');
    expect(docs).toHaveLength(2);
    expect(docs.map(d => d.topicId)).toEqual(['201', '202']);
  });

  it('7. saves and retrieves enrolled courses', async () => {
    const enrolledCourses: EnrolledCourse[] = [
      { orgUnitId: '88421', name: 'CS101', code: 'CS101-2026', isActive: true },
      { orgUnitId: '88422', name: 'CS102', code: 'CS102-2026', isActive: true },
    ];

    await storage.saveEnrolledCourses(enrolledCourses);
    const retrieved = await storage.getEnrolledCourses();

    expect(retrieved).toHaveLength(2);
    expect(retrieved.map(c => c.orgUnitId)).toContain('88421');
    expect(retrieved.map(c => c.orgUnitId)).toContain('88422');
  });

  it('8. checks cache expiration correctly', () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;

    // Default TTL is 24 hours (1440 minutes)
    expect(storage.isCacheExpired(oneHourAgo)).toBe(false);
    expect(storage.isCacheExpired(twoDaysAgo)).toBe(true);

    // Custom 30-minute TTL
    expect(storage.isCacheExpired(oneHourAgo, 30)).toBe(true);
  });

  it('9. clears course cache including associated parsed documents', async () => {
    await storage.saveCourseData(sampleCourseData);
    await storage.saveParsedDocument(sampleParsedDoc, '88421');

    await storage.clearCourseCache('88421');

    expect(await storage.getCourseData('88421')).toBeNull();
    expect(await storage.getParsedDocument('201')).toBeNull();
  });

  it('10. clears all data across all stores', async () => {
    await storage.saveCourseData(sampleCourseData);
    await storage.saveParsedDocument(sampleParsedDoc, '88421');
    await storage.saveEnrolledCourses([{ orgUnitId: '88421', name: 'CS101', code: 'CS101', isActive: true }]);

    await storage.clearAllData();

    expect(await storage.getCourseData('88421')).toBeNull();
    expect(await storage.getParsedDocumentsForCourse('88421')).toHaveLength(0);
    expect(await storage.getEnrolledCourses()).toHaveLength(0);
  });
});

