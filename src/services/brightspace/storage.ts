import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { CourseData, EnrolledCourse, ParsedDocument } from '@/types/brightspace';

export const DB_NAME = 'brightspace_ai_helper_db';
export const DB_VERSION = 1;

export interface StoredCourseRecord extends EnrolledCourse {
  updatedAt: number;
}

export interface StoredParsedDocument extends ParsedDocument {
  orgUnitId: string;
  fileSizeBytes?: number;
  parsedAt: number;
}

export interface BrightspaceHelperDB extends DBSchema {
  courses: {
    key: string; // orgUnitId
    value: StoredCourseRecord;
    indexes: {
      by_code: string;
      by_updated: number;
    };
  };
  course_data: {
    key: string; // orgUnitId
    value: CourseData;
    indexes: {
      by_fetched_at: number;
    };
  };
  parsed_documents: {
    key: string; // topicId
    value: StoredParsedDocument;
    indexes: {
      by_course: string;
      by_type: string;
      by_parsed_at: number;
    };
  };
  settings: {
    key: string;
    value: any;
  };
}

/**
 * Deep clone utility to ensure in-memory storage maintains full object isolation
 * matching IndexedDB structured-clone semantics.
 */
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      // Fallback if object contains non-cloneable elements
    }
  }
  return JSON.parse(JSON.stringify(obj));
}


export class InMemoryStorage {
  private courses = new Map<string, StoredCourseRecord>();
  private courseData = new Map<string, CourseData>();
  private parsedDocuments = new Map<string, StoredParsedDocument>();
  private settings = new Map<string, any>();

  async getCourseData(orgUnitId: string): Promise<CourseData | null> {
    const data = this.courseData.get(orgUnitId);
    return data ? deepClone(data) : null;
  }

  async saveCourseData(data: CourseData): Promise<void> {
    this.courseData.set(data.orgUnitId, deepClone(data));
  }

  async deleteCourseData(orgUnitId: string): Promise<void> {
    this.courseData.delete(orgUnitId);
  }

  async getParsedDocument(topicId: string): Promise<ParsedDocument | null> {
    const doc = this.parsedDocuments.get(topicId);
    return doc ? deepClone(doc) : null;
  }

  async saveParsedDocument(doc: ParsedDocument, orgUnitId: string, size = 0): Promise<void> {
    const record: StoredParsedDocument = {
      ...doc,
      orgUnitId,
      fileSizeBytes: size,
      parsedAt: Date.now(),
    };
    this.parsedDocuments.set(doc.topicId, deepClone(record));
  }

  async getParsedDocumentsForCourse(orgUnitId: string): Promise<ParsedDocument[]> {
    return Array.from(this.parsedDocuments.values())
      .filter(d => d.orgUnitId === orgUnitId)
      .map(d => deepClone(d));
  }

  async deleteParsedDocument(topicId: string): Promise<void> {
    this.parsedDocuments.delete(topicId);
  }

  async getEnrolledCourses(): Promise<EnrolledCourse[]> {
    return Array.from(this.courses.values()).map(c => deepClone(c));
  }

  async saveEnrolledCourses(courses: EnrolledCourse[]): Promise<void> {
    for (const c of courses) {
      this.courses.set(c.orgUnitId, deepClone({ ...c, updatedAt: Date.now() }));
    }
  }

  async clearCourseCache(orgUnitId: string): Promise<void> {
    if (!orgUnitId || !orgUnitId.trim()) return;
    const trimmedId = orgUnitId.trim();

    this.courseData.delete(trimmedId);
    for (const [k, v] of this.parsedDocuments.entries()) {
      // files the student added themselves (ids "user:...") are not cache and survive this
      if (v.orgUnitId === trimmedId && !k.startsWith('user:')) {
        this.parsedDocuments.delete(k);
      }
    }
  }

  async clearAllData(): Promise<void> {
    this.courses.clear();
    this.courseData.clear();
    this.parsedDocuments.clear();
    this.settings.clear();
  }
}

export class StorageService {
  private dbPromise: Promise<IDBPDatabase<BrightspaceHelperDB>> | null = null;
  private fallbackMemory: InMemoryStorage | null = null;

  public async close(): Promise<void> {
    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        if (db) {
          db.close();
        }
      } catch {
        // ignore
      }
      this.dbPromise = null;
    }
  }

  private async getDb(): Promise<IDBPDatabase<BrightspaceHelperDB> | null> {
    if (this.fallbackMemory) return null;
    if (typeof indexedDB === 'undefined') {
      this.fallbackMemory = new InMemoryStorage();
      return null;
    }

    if (!this.dbPromise) {
      try {
        this.dbPromise = openDB<BrightspaceHelperDB>(DB_NAME, DB_VERSION, {
          upgrade(db) {
            // 1. Courses store
            if (!db.objectStoreNames.contains('courses')) {
              const courseStore = db.createObjectStore('courses', { keyPath: 'orgUnitId' });
              courseStore.createIndex('by_code', 'code');
              courseStore.createIndex('by_updated', 'updatedAt');
            }
            // 2. Course Data store
            if (!db.objectStoreNames.contains('course_data')) {
              const dataStore = db.createObjectStore('course_data', { keyPath: 'orgUnitId' });
              dataStore.createIndex('by_fetched_at', 'fetchedAt');
            }
            // 3. Parsed Documents store
            if (!db.objectStoreNames.contains('parsed_documents')) {
              const docStore = db.createObjectStore('parsed_documents', { keyPath: 'topicId' });
              docStore.createIndex('by_course', 'orgUnitId');
              docStore.createIndex('by_type', 'fileType');
              docStore.createIndex('by_parsed_at', 'parsedAt');
            }
            // 4. Settings store
            if (!db.objectStoreNames.contains('settings')) {
              db.createObjectStore('settings');
            }
          },
          blocking: () => {
            if (this.dbPromise) {
              this.dbPromise.then(db => {
                if (db) db.close();
              }).catch(() => {});
              this.dbPromise = null;
            }
          },
        }).catch(err => {
          console.warn('IndexedDB unavailable, falling back to memory storage:', err);
          this.fallbackMemory = new InMemoryStorage();
          return null as any;
        });
      } catch (syncErr) {
        console.warn('IndexedDB.open threw synchronously, falling back to memory storage:', syncErr);
        this.fallbackMemory = new InMemoryStorage();
        return null;
      }
    }
    return this.dbPromise;
  }

  // ==========================================
  // Course Data Operations
  // ==========================================

  async getCourseData(orgUnitId: string): Promise<CourseData | null> {
    const db = await this.getDb();
    if (!db) return this.fallbackMemory!.getCourseData(orgUnitId);
    try {
      const result = await db.get('course_data', orgUnitId);
      return result || null;
    } catch (err) {
      console.warn(`Error reading CourseData for ${orgUnitId}:`, err);
      return null;
    }
  }

  async saveCourseData(data: CourseData): Promise<void> {
    const db = await this.getDb();
    if (!db) return this.fallbackMemory!.saveCourseData(data);
    try {
      await db.put('course_data', data);
    } catch (err: any) {
      if (err?.name === 'QuotaExceededError') {
        console.warn('IndexedDB quota exceeded while saving CourseData:', err);
      } else {
        throw err;
      }
    }
  }

  async deleteCourseData(orgUnitId: string): Promise<void> {
    const db = await this.getDb();
    if (!db) return this.fallbackMemory!.deleteCourseData(orgUnitId);
    await db.delete('course_data', orgUnitId);
  }

  // ==========================================
  // Parsed Document Operations
  // ==========================================

  async getParsedDocument(topicId: string): Promise<ParsedDocument | null> {
    const db = await this.getDb();
    if (!db) return this.fallbackMemory!.getParsedDocument(topicId);
    try {
      const record = await db.get('parsed_documents', topicId);
      return record || null;
    } catch (err) {
      console.warn(`Error reading parsed document ${topicId}:`, err);
      return null;
    }
  }

  async saveParsedDocument(doc: ParsedDocument, orgUnitId: string, fileSizeBytes = 0): Promise<void> {
    const db = await this.getDb();
    if (!db) return this.fallbackMemory!.saveParsedDocument(doc, orgUnitId, fileSizeBytes);
    const record: StoredParsedDocument = {
      ...doc,
      orgUnitId,
      fileSizeBytes,
      parsedAt: Date.now(),
    };
    try {
      await db.put('parsed_documents', record);
    } catch (err: any) {
      if (err?.name === 'QuotaExceededError') {
        console.warn('IndexedDB quota exceeded while saving parsed document:', err);
      } else {
        throw err;
      }
    }
  }

  async getParsedDocumentsForCourse(orgUnitId: string): Promise<ParsedDocument[]> {
    const db = await this.getDb();
    if (!db) return this.fallbackMemory!.getParsedDocumentsForCourse(orgUnitId);
    try {
      return await db.getAllFromIndex('parsed_documents', 'by_course', orgUnitId);
    } catch (err) {
      console.warn(`Error querying documents for course ${orgUnitId}:`, err);
      return [];
    }
  }

  async deleteParsedDocument(topicId: string): Promise<void> {
    const db = await this.getDb();
    if (!db) return this.fallbackMemory!.deleteParsedDocument(topicId);
    await db.delete('parsed_documents', topicId);
  }

  // ==========================================
  // Enrolled Courses Operations
  // ==========================================

  async getEnrolledCourses(): Promise<EnrolledCourse[]> {
    const db = await this.getDb();
    if (!db) return this.fallbackMemory!.getEnrolledCourses();
    try {
      return await db.getAll('courses');
    } catch (err) {
      console.warn('Error reading enrolled courses:', err);
      return [];
    }
  }

  async saveEnrolledCourses(courses: EnrolledCourse[]): Promise<void> {
    const db = await this.getDb();
    if (!db) return this.fallbackMemory!.saveEnrolledCourses(courses);
    const tx = db.transaction('courses', 'readwrite');
    for (const c of courses) {
      await tx.store.put({
        ...c,
        updatedAt: Date.now(),
      });
    }
    await tx.done;
  }

  // ==========================================
  // Cache Eviction & Invalidation Helpers
  // ==========================================

  isCacheExpired(fetchedAt: number, ttlMinutes: number = 60 * 24): boolean {
    if (!fetchedAt) return true;
    const now = Date.now();
    const maxAgeMs = ttlMinutes * 60 * 1000;
    return now - fetchedAt > maxAgeMs;
  }

  async clearCourseCache(orgUnitId: string): Promise<void> {
    if (!orgUnitId || !orgUnitId.trim()) return;
    const trimmedId = orgUnitId.trim();

    // Clear from fallback memory if active
    if (this.fallbackMemory) {
      await this.fallbackMemory.clearCourseCache(trimmedId);
    }

    let db = await this.getDb();
    if (!db && this.dbPromise) {
      try {
        db = await this.dbPromise;
      } catch {
        db = null;
      }
    }
    if (!db) return;

    try {
      const txData = db.transaction('course_data', 'readwrite');
      await txData.store.delete(trimmedId);
      await txData.done;
    } catch (err) {
      console.warn(`Error deleting course_data for ${trimmedId}:`, err);
    }

    // Delete associated parsed documents
    try {
      const docs = await this.getParsedDocumentsForCourse(trimmedId);
      if (docs.length > 0) {
        const txDoc = db.transaction('parsed_documents', 'readwrite');
        for (const d of docs) {
          if (d.topicId.startsWith('user:')) continue; // the student's own files survive a cache clear
          await txDoc.store.delete(d.topicId);
        }
        await txDoc.done;
      }
    } catch (err) {
      console.warn(`Error deleting parsed documents for ${trimmedId}:`, err);
    }

  }

  async clearAllData(): Promise<void> {
    if (this.fallbackMemory) {
      await this.fallbackMemory.clearAllData();
    }
    let db = await this.getDb();
    if (!db && this.dbPromise) {
      try {
        db = await this.dbPromise;
      } catch {
        db = null;
      }
    }
    if (!db) return;
    try {
      await db.clear('courses');
      await db.clear('course_data');
      await db.clear('parsed_documents');
      await db.clear('settings');
    } catch (err) {
      console.warn('Error clearing IndexedDB data:', err);
    }
  }
}

export const storage = new StorageService();
