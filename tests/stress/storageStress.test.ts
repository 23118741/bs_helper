import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { StorageService, DB_NAME, InMemoryStorage } from '@/services/brightspace/storage';
import { CourseData, EnrolledCourse, ParsedDocument } from '@/types/brightspace';

describe('Empirical Stress Testing — storage.ts', () => {
  let storage: StorageService;

  beforeEach(async () => {
    storage = new StorageService();
    await storage.clearAllData();
  });

  afterEach(async () => {
    try {
      const db = await (storage as any)?.dbPromise;
      if (db && typeof db.close === 'function') {
        db.close();
      }
    } catch {
      // ignore
    }
  });

  // =========================================================================
  // SUITE 1: Concurrency & Rapid Concurrent Writes
  // =========================================================================
  describe('1. High Concurrency & Parallel Writes', () => {
    it('handles 100 parallel saveCourseData writes across distinct courses without data corruption', async () => {
      const courseCount = 100;
      const tasks = Array.from({ length: courseCount }, (_, i) => {
        const id = String(20000 + i);
        const data: CourseData = {
          orgUnitId: id,
          courseName: `Parallel Course ${id}`,
          fetchedAt: Date.now() + i,
          overview: { title: `Overview ${id}`, htmlContent: '', textDescription: '' },
          toc: [{ moduleId: `m_${id}`, title: `Module ${id}`, subModules: [], topics: [] }],
        };
        return storage.saveCourseData(data);
      });

      await Promise.all(tasks);

      // Verify all 100 courses were saved and can be retrieved accurately
      const verifyTasks = Array.from({ length: courseCount }, async (_, i) => {
        const id = String(20000 + i);
        const course = await storage.getCourseData(id);
        expect(course).not.toBeNull();
        expect(course?.orgUnitId).toBe(id);
        expect(course?.courseName).toBe(`Parallel Course ${id}`);
      });
      await Promise.all(verifyTasks);
    });

    it('handles 50 rapid concurrent overwrites to the SAME course correctly', async () => {
      const orgUnitId = '30001';
      const tasks = Array.from({ length: 50 }, (_, i) => {
        const data: CourseData = {
          orgUnitId,
          courseName: `Overwrite Version ${i}`,
          fetchedAt: 1000 + i,
        };
        return storage.saveCourseData(data);
      });

      // All 50 writes run concurrently
      await Promise.all(tasks);

      // Read back the course; must exist and be one of the valid writes
      const record = await storage.getCourseData(orgUnitId);
      expect(record).not.toBeNull();
      expect(record?.orgUnitId).toBe(orgUnitId);
      expect(record?.courseName).toMatch(/^Overwrite Version \d+$/);
    });

    it('handles 100 parallel saveParsedDocument operations and queries by course index', async () => {
      const orgUnitId = '30002';
      const docCount = 100;

      const tasks = Array.from({ length: docCount }, (_, i) => {
        const doc: ParsedDocument = {
          topicId: `topic_${i}`,
          filename: `Lecture_${i}.pdf`,
          fileType: 'pdf',
          extractedText: `[Page 1]\nContent for lecture ${i}`,
          metadata: { pageCount: i + 1, extractedAt: Date.now() },
        };
        return storage.saveParsedDocument(doc, orgUnitId, 1024 * (i + 1));
      });

      await Promise.all(tasks);

      const docs = await storage.getParsedDocumentsForCourse(orgUnitId);
      expect(docs).toHaveLength(docCount);

      // Verify random topic retrieval
      const doc50 = await storage.getParsedDocument('topic_50');
      expect(doc50).not.toBeNull();
      expect(doc50?.filename).toBe('Lecture_50.pdf');
    });

    it('handles simultaneous reads, writes, and deletes without unhandled rejections', async () => {
      const orgUnitId = '30003';
      const initial: CourseData = { orgUnitId, courseName: 'Initial', fetchedAt: Date.now() };
      await storage.saveCourseData(initial);

      const mixedOps: Promise<any>[] = [];
      for (let i = 0; i < 30; i++) {
        if (i % 3 === 0) {
          mixedOps.push(storage.saveCourseData({ orgUnitId, courseName: `V_${i}`, fetchedAt: Date.now() }));
        } else if (i % 3 === 1) {
          mixedOps.push(storage.getCourseData(orgUnitId));
        } else {
          mixedOps.push(storage.saveParsedDocument(
            { topicId: `top_${i}`, filename: `doc_${i}.pdf`, fileType: 'pdf', extractedText: 'text', metadata: { extractedAt: Date.now() } },
            orgUnitId
          ));
        }
      }

      await expect(Promise.all(mixedOps)).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // SUITE 2: Large Datasets & Extreme Serialization
  // =========================================================================
  describe('2. Large Payloads & Data Serialization Stress', () => {
    it('persists and retrieves a massive CourseData payload with 5,000 topics and nested submodules', async () => {
      const orgUnitId = '40001';
      const topics: any[] = [];
      for (let i = 0; i < 5000; i++) {
        topics.push({
          topicId: `large_topic_${i}`,
          title: `Large Course Document ${i}.pdf`,
          type: 'file',
          fileExtension: 'pdf',
          downloadUrl: `/d2l/api/le/1.74/${orgUnitId}/content/topics/large_topic_${i}/file`,
        });
      }

      const massiveData: CourseData = {
        orgUnitId,
        courseName: 'Massive Scaled Course',
        fetchedAt: Date.now(),
        domFallbackText: 'Very long dom fallback text. '.repeat(10000), // ~300KB
        toc: [
          {
            moduleId: 'mod_huge',
            title: 'Huge Module with 5000 Topics',
            subModules: [],
            topics,
          },
        ],
      };

      const start = performance.now();
      await storage.saveCourseData(massiveData);
      const writeTime = performance.now() - start;

      const readStart = performance.now();
      const retrieved = await storage.getCourseData(orgUnitId);
      const readTime = performance.now() - readStart;

      expect(retrieved).not.toBeNull();
      expect(retrieved?.toc?.[0]?.topics).toHaveLength(5000);
      expect(retrieved?.domFallbackText?.length).toBeGreaterThan(200000);
      expect(writeTime).toBeLessThan(3000); // Must write under 3s in fake-indexeddb
      expect(readTime).toBeLessThan(1000); // Must read under 1s
    });

    it('persists large parsed text document (5MB string) without truncation', async () => {
      const orgUnitId = '40002';
      const fiveMbText = 'A'.repeat(5 * 1024 * 1024); // 5 megabytes

      const doc: ParsedDocument = {
        topicId: 'doc_5mb',
        filename: 'GiantTextbook.pdf',
        fileType: 'pdf',
        extractedText: fiveMbText,
        metadata: {
          pageCount: 1200,
          extractedAt: Date.now(),
        },
      };

      await storage.saveParsedDocument(doc, orgUnitId, fiveMbText.length);
      const retrieved = await storage.getParsedDocument('doc_5mb');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.extractedText.length).toBe(fiveMbText.length);
      expect(retrieved?.metadata.pageCount).toBe(1200);
    });

    it('serializes extreme unicode, emojis, RTL characters, and null bytes cleanly', async () => {
      const orgUnitId = '40003';
      const trickyString = '🚀 Modern AI & LLMs: 👨‍👩‍👧‍👦 \u0000 Null byte test \uD83D\uDE00 RTL: עברית العربية / 日本語 / 🇨🇳';

      const data: CourseData = {
        orgUnitId,
        courseName: trickyString,
        fetchedAt: Date.now(),
        overview: {
          title: trickyString,
          htmlContent: `<p>${trickyString}</p>`,
          textDescription: trickyString,
        },
      };

      await storage.saveCourseData(data);
      const retrieved = await storage.getCourseData(orgUnitId);

      expect(retrieved?.courseName).toBe(trickyString);
      expect(retrieved?.overview?.title).toBe(trickyString);
    });

    it('handles batch of 2,000 enrolled courses in a single transaction', async () => {
      const courses: EnrolledCourse[] = Array.from({ length: 2000 }, (_, i) => ({
        orgUnitId: `batch_course_${i}`,
        name: `Enrolled Course ${i}`,
        code: `CODE-${i}`,
        isActive: i % 2 === 0,
      }));

      await storage.saveEnrolledCourses(courses);
      const retrieved = await storage.getEnrolledCourses();

      expect(retrieved).toHaveLength(2000);
      expect(retrieved.find(c => c.orgUnitId === 'batch_course_1999')?.code).toBe('CODE-1999');
    });
  });

  // =========================================================================
  // SUITE 3: Cache Invalidation & Multi-Tenant Course Isolation
  // =========================================================================
  describe('3. Cache Invalidation & Multi-Course Isolation', () => {
    it('clears cache for course A while strictly preserving course B and C', async () => {
      // Setup Course A, B, C with documents
      for (const orgId of ['COURSE_A', 'COURSE_B', 'COURSE_C']) {
        await storage.saveCourseData({ orgUnitId: orgId, courseName: orgId, fetchedAt: Date.now() });
        for (let i = 1; i <= 3; i++) {
          await storage.saveParsedDocument(
            { topicId: `${orgId}_doc_${i}`, filename: `doc_${i}.pdf`, fileType: 'pdf', extractedText: 'test', metadata: { extractedAt: Date.now() } },
            orgId
          );
        }
      }

      // Clear only COURSE_A
      await storage.clearCourseCache('COURSE_A');

      // COURSE_A must be wiped
      expect(await storage.getCourseData('COURSE_A')).toBeNull();
      expect(await storage.getParsedDocumentsForCourse('COURSE_A')).toHaveLength(0);
      expect(await storage.getParsedDocument('COURSE_A_doc_1')).toBeNull();

      // COURSE_B and COURSE_C must be completely intact
      expect(await storage.getCourseData('COURSE_B')).not.toBeNull();
      expect(await storage.getParsedDocumentsForCourse('COURSE_B')).toHaveLength(3);
      expect(await storage.getCourseData('COURSE_C')).not.toBeNull();
      expect(await storage.getParsedDocumentsForCourse('COURSE_C')).toHaveLength(3);
    });

    it('clearAllData completely empties all 4 stores', async () => {
      await storage.saveCourseData({ orgUnitId: '50001', courseName: 'Test', fetchedAt: Date.now() });
      await storage.saveParsedDocument({ topicId: '50001_d', filename: 'd.pdf', fileType: 'pdf', extractedText: '', metadata: { extractedAt: Date.now() } }, '50001');
      await storage.saveEnrolledCourses([{ orgUnitId: '50001', name: 'Course', code: 'C', isActive: true }]);

      await storage.clearAllData();

      expect(await storage.getCourseData('50001')).toBeNull();
      expect(await storage.getParsedDocumentsForCourse('50001')).toHaveLength(0);
      expect(await storage.getEnrolledCourses()).toHaveLength(0);
    });
  });

  // =========================================================================
  // SUITE 4: In-Memory Storage Fallback Verification
  // =========================================================================
  describe('4. In-Memory Fallback Mechanism', () => {
    it('falls back to memory storage seamlessly when indexedDB is undefined', async () => {
      const originalIndexedDB = globalThis.indexedDB;
      try {
        // Force indexedDB to be undefined
        // @ts-ignore
        delete (globalThis as any).indexedDB;

        const memoryStorage = new StorageService();

        // 1. CourseData operations
        await memoryStorage.saveCourseData({ orgUnitId: 'mem_1', courseName: 'Memory Course', fetchedAt: 12345 });
        const course = await memoryStorage.getCourseData('mem_1');
        expect(course).not.toBeNull();
        expect(course?.courseName).toBe('Memory Course');

        // 2. ParsedDocument operations
        await memoryStorage.saveParsedDocument(
          { topicId: 'mem_top_1', filename: 'mem.pdf', fileType: 'pdf', extractedText: 'memory text', metadata: { extractedAt: Date.now() } },
          'mem_1',
          100
        );
        const doc = await memoryStorage.getParsedDocument('mem_top_1');
        expect(doc?.extractedText).toBe('memory text');
        const docs = await memoryStorage.getParsedDocumentsForCourse('mem_1');
        expect(docs).toHaveLength(1);

        // 3. Enrolled courses operations
        await memoryStorage.saveEnrolledCourses([{ orgUnitId: 'mem_1', name: 'Enrolled Mem', code: 'M1', isActive: true }]);
        const enrolled = await memoryStorage.getEnrolledCourses();
        expect(enrolled).toHaveLength(1);

        // 4. Delete & cache clearing
        await memoryStorage.clearCourseCache('mem_1');
        expect(await memoryStorage.getCourseData('mem_1')).toBeNull();
        expect(await memoryStorage.getParsedDocumentsForCourse('mem_1')).toHaveLength(0);

        // 5. Clear all data
        await memoryStorage.saveCourseData({ orgUnitId: 'mem_2', courseName: 'Mem 2', fetchedAt: 1 });
        await memoryStorage.clearAllData();
        expect(await memoryStorage.getCourseData('mem_2')).toBeNull();
      } finally {
        globalThis.indexedDB = originalIndexedDB;
      }
    });

    it('falls back to memory storage when openDB rejects asynchronously with VersionError', async () => {
      // 1. Close the open DB connection from beforeEach
      const existingDb = await (storage as any).dbPromise;
      if (existingDb) {
        existingDb.close();
      }

      // 2. Pre-create the database at version 2 using fake-indexeddb
      const req = indexedDB.open(DB_NAME, 2);
      await new Promise<void>((resolve, reject) => {
        req.onupgradeneeded = () => {};
        req.onsuccess = () => {
          req.result.close();
          resolve();
        };
        req.onerror = () => reject(req.error);
      });

      // 3. Now initialize StorageService which requests DB_VERSION = 1.
      // IndexedDB will asynchronously reject with a VersionError ("The requested version (1) is less than the existing version (2).")
      const fallbackStorage = new StorageService();

      // Write to storage; must fall back to memory without throwing uncaught VersionError
      await fallbackStorage.saveCourseData({
        orgUnitId: 'downgrade_1',
        courseName: 'Version Downgrade Course',
        fetchedAt: Date.now(),
      });

      const result = await fallbackStorage.getCourseData('downgrade_1');
      expect(result).not.toBeNull();
      expect(result?.courseName).toBe('Version Downgrade Course');
    });

    it('falls back to memory storage when indexedDB.open throws synchronously', async () => {
      const originalIndexedDB = globalThis.indexedDB;
      try {
        globalThis.indexedDB = {
          open: () => {
            throw new DOMException('The operation is insecure in private browsing', 'SecurityError');
          },
        } as any;

        const insecureStorage = new StorageService();
        await insecureStorage.saveCourseData({ orgUnitId: 'sec_1', courseName: 'Test Insecure', fetchedAt: 1 });
        const retrieved = await insecureStorage.getCourseData('sec_1');
        expect(retrieved).not.toBeNull();
        expect(retrieved?.courseName).toBe('Test Insecure');
      } finally {
        globalThis.indexedDB = originalIndexedDB;
      }
    });
  });

  describe('In-Memory Deep Cloning & Mutation Immunity', () => {
    it('prevents in-place mutation of CourseData after saveCourseData', async () => {
      const memStorage = new InMemoryStorage();
      const original: CourseData = {
        orgUnitId: 'clone_101',
        courseName: 'Immutable AI Course',
        fetchedAt: 1000,
        overview: {
          title: 'Initial Title',
          htmlContent: '<p>Initial</p>',
          textDescription: 'Initial',
        },
        toc: [
          {
            moduleId: 'mod_1',
            title: 'Module 1',
            subModules: [],
            topics: [],
          },
        ],
      };

      await memStorage.saveCourseData(original);

      // Mutate the caller object in place
      original.courseName = 'Mutated AI Course';
      original.overview!.title = 'Mutated Title';
      original.toc!.push({
        moduleId: 'mod_2',
        title: 'Module 2',
        subModules: [],
        topics: [],
      });

      const retrieved = await memStorage.getCourseData('clone_101');
      expect(retrieved?.courseName).toBe('Immutable AI Course');
      expect(retrieved?.overview?.title).toBe('Initial Title');
      expect(retrieved?.toc).toHaveLength(1);
    });

    it('prevents in-place mutation of CourseData retrieved from storage', async () => {
      const memStorage = new InMemoryStorage();
      await memStorage.saveCourseData({
        orgUnitId: 'clone_102',
        courseName: 'Second Course',
        fetchedAt: 2000,
        toc: [{ moduleId: 'm1', title: 'M1', subModules: [], topics: [] }],
      });

      const retrieved1 = await memStorage.getCourseData('clone_102');
      expect(retrieved1).not.toBeNull();
      retrieved1!.courseName = 'Mutated After Read';
      retrieved1!.toc!.push({ moduleId: 'm2', title: 'M2', subModules: [], topics: [] });

      const retrieved2 = await memStorage.getCourseData('clone_102');
      expect(retrieved2?.courseName).toBe('Second Course');
      expect(retrieved2?.toc).toHaveLength(1);
    });

    it('prevents mutation of ParsedDocument and its nested metadata', async () => {
      const memStorage = new InMemoryStorage();
      const doc: ParsedDocument = {
        topicId: 'doc_clone_1',
        filename: 'slides.pptx',
        fileType: 'pptx',
        extractedText: '[Slide 1] Overview',
        metadata: {
          slideCount: 10,
          extractedAt: 12345,
        },
      };

      await memStorage.saveParsedDocument(doc, 'clone_101');

      // Mutate caller object
      doc.metadata.slideCount = 999;
      doc.extractedText = 'mutated text';

      const retrievedDoc = await memStorage.getParsedDocument('doc_clone_1');
      expect(retrievedDoc?.metadata.slideCount).toBe(10);
      expect(retrievedDoc?.extractedText).toBe('[Slide 1] Overview');

      // Mutate retrieved object
      retrievedDoc!.metadata.slideCount = 888;
      const secondDoc = await memStorage.getParsedDocument('doc_clone_1');
      expect(secondDoc?.metadata.slideCount).toBe(10);
    });

    it('prevents mutation of EnrolledCourse array and objects', async () => {
      const memStorage = new InMemoryStorage();
      const courses: EnrolledCourse[] = [
        { orgUnitId: 'enr_101', name: 'Course 101', code: 'CS101', isActive: true },
      ];

      await memStorage.saveEnrolledCourses(courses);

      // Mutate input array
      courses[0].name = 'Mutated Input';
      courses.push({ orgUnitId: 'enr_102', name: 'Course 102', code: 'CS102', isActive: false });

      const retrieved = await memStorage.getEnrolledCourses();
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].name).toBe('Course 101');

      // Mutate retrieved array
      retrieved[0].name = 'Mutated Output';
      const retrievedAgain = await memStorage.getEnrolledCourses();
      expect(retrievedAgain[0].name).toBe('Course 101');
    });
  });
});
