import { describe, it, expect } from 'vitest';
import {
  isBrightspaceUrl,
  detectOrgUnitId,
  getCourseHomeUrl,
  getBrightspaceOrigin,
} from '@/services/brightspace/courseDetector';

describe('Course Detector Service', () => {
  describe('Suite 1: Domain Detection (isBrightspaceUrl)', () => {
    it('identifies standard brightspace.com domains', () => {
      expect(isBrightspaceUrl('https://purdue.brightspace.com/d2l/home')).toBe(true);
      expect(isBrightspaceUrl('https://sub.campus.brightspace.com/d2l/home/1234')).toBe(true);
      expect(isBrightspaceUrl('https://brightspace.com')).toBe(true);
      expect(isBrightspaceUrl('http://myuni.brightspace.com')).toBe(true);
    });

    it('identifies institutional vanity domains containing /d2l/', () => {
      expect(isBrightspaceUrl('https://brightspace.tudelft.nl/d2l/home/684201')).toBe(true);
      expect(isBrightspaceUrl('https://learn.ou.nl/d2l/le/content/1234/Home')).toBe(true);
      expect(isBrightspaceUrl('https://d2l.arizona.edu/d2l/home')).toBe(true);
      expect(isBrightspaceUrl('https://mylearning.suny.edu/d2l/lms/dropbox/user/folders_list.d2l?ou=987')).toBe(true);
    });

    it('identifies localhost and offline test environment pages', () => {
      expect(isBrightspaceUrl('http://localhost:5173/test-page/mock-brightspace.html?ou=88421')).toBe(true);
      expect(isBrightspaceUrl('http://127.0.0.1:8080/test-page/mock-brightspace.html')).toBe(true);
      expect(isBrightspaceUrl('http://localhost:3000/d2l/home')).toBe(true);
      expect(isBrightspaceUrl('file:///home/user/brightspace_helper/test-page/mock-brightspace.html')).toBe(true);
    });

    it('rejects non-Brightspace URLs and invalid input', () => {
      expect(isBrightspaceUrl('https://canvas.instructure.com/courses/12345')).toBe(false);
      expect(isBrightspaceUrl('https://blackboard.univ.edu/webapps/login')).toBe(false);
      expect(isBrightspaceUrl('https://google.com')).toBe(false);
      expect(isBrightspaceUrl('https://example.com/notd2l/home')).toBe(false);
      expect(isBrightspaceUrl('https://fake-brightspace.com.evil.com/login')).toBe(false);
      expect(isBrightspaceUrl('')).toBe(false);
      expect(isBrightspaceUrl('not a valid url')).toBe(false);
    });
  });

  describe('Suite 2: OrgUnitId Extraction from Path (detectOrgUnitId)', () => {
    it('extracts orgUnitId from Course Home paths', () => {
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/home/12345')).toEqual({
        orgUnitId: '12345',
        source: 'path',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/home/12345/')).toEqual({
        orgUnitId: '12345',
        source: 'path',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/home/12345?tab=2')).toEqual({
        orgUnitId: '12345',
        source: 'path',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/home/12345#news')).toEqual({
        orgUnitId: '12345',
        source: 'path',
      });
    });

    it('returns null for institutional landing root pages without course ID', () => {
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/home')).toEqual({
        orgUnitId: null,
        source: null,
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/home/')).toEqual({
        orgUnitId: null,
        source: null,
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/home/about')).toEqual({
        orgUnitId: null,
        source: null,
      });
    });

    it('extracts orgUnitId from content and lessons paths', () => {
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/le/content/67890/Home')).toEqual({
        orgUnitId: '67890',
        source: 'path',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/le/content/67890/toc')).toEqual({
        orgUnitId: '67890',
        source: 'path',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/le/content/67890/viewContent/998877/View')).toEqual({
        orgUnitId: '67890',
        source: 'path',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/le/lessons/54321/units/10')).toEqual({
        orgUnitId: '54321',
        source: 'path',
      });
    });

    it('extracts orgUnitId from other LE tool paths', () => {
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/le/calendar/11223')).toEqual({
        orgUnitId: '11223',
        source: 'path',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/le/dropbox/33445')).toEqual({
        orgUnitId: '33445',
        source: 'path',
      });
    });
  });

  describe('Suite 3: OrgUnitId Extraction from Query Parameters (detectOrgUnitId)', () => {
    it('extracts orgUnitId from standard LMS query URLs', () => {
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/lms/dropbox/user/folders_list.d2l?ou=44556')).toEqual({
        orgUnitId: '44556',
        source: 'query',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/lms/quizzing/user/quizzes_list.d2l?ou=44556&isPaging=1')).toEqual({
        orgUnitId: '44556',
        source: 'query',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/lms/grades/my_grades/main.d2l?filter=all&ou=44556')).toEqual({
        orgUnitId: '44556',
        source: 'query',
      });
    });

    it('handles case-insensitive query parameter keys (OU, Ou)', () => {
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/lms/news/main.d2l?OU=44556')).toEqual({
        orgUnitId: '44556',
        source: 'query',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/lms/news/main.d2l?Ou=44556')).toEqual({
        orgUnitId: '44556',
        source: 'query',
      });
    });

    it('extracts orgUnitId from mock test page query string', () => {
      expect(detectOrgUnitId('http://localhost:5173/test-page/mock-brightspace.html?ou=88421')).toEqual({
        orgUnitId: '88421',
        source: 'query',
      });
    });

    it('rejects invalid or non-numeric query parameters', () => {
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/lms/page.d2l?ou=')).toEqual({
        orgUnitId: null,
        source: null,
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/lms/page.d2l?ou=abc')).toEqual({
        orgUnitId: null,
        source: null,
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/lms/page.d2l?ou=123a')).toEqual({
        orgUnitId: null,
        source: null,
      });
    });
  });

  describe('Suite 4: Precedence, Relative URLs & Helper Functions', () => {
    it('prioritizes path match over query parameter when both are present', () => {
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/le/content/12345/Home?ou=12345')).toEqual({
        orgUnitId: '12345',
        source: 'path',
      });
      expect(detectOrgUnitId('https://myuni.brightspace.com/d2l/le/content/12345/Home?ou=99999')).toEqual({
        orgUnitId: '12345',
        source: 'path',
      });
    });

    it('handles relative URLs safely', () => {
      expect(detectOrgUnitId('/d2l/home/77889')).toEqual({
        orgUnitId: '77889',
        source: 'path',
      });
      expect(detectOrgUnitId('/d2l/lms/dropbox/user/folders_list.d2l?ou=77889')).toEqual({
        orgUnitId: '77889',
        source: 'query',
      });
    });

    it('constructs canonical course home URL', () => {
      expect(getCourseHomeUrl('https://myuni.brightspace.com', '12345')).toBe(
        'https://myuni.brightspace.com/d2l/home/12345'
      );
      expect(getCourseHomeUrl('https://myuni.brightspace.com/', '12345')).toBe(
        'https://myuni.brightspace.com/d2l/home/12345'
      );
    });

    it('extracts Brightspace origin from URLs', () => {
      expect(getBrightspaceOrigin('https://myuni.brightspace.com/d2l/home/12345')).toBe(
        'https://myuni.brightspace.com'
      );
      expect(getBrightspaceOrigin('http://localhost:5173/test-page/mock-brightspace.html?ou=88421')).toBe(
        'http://localhost:5173'
      );
      expect(getBrightspaceOrigin('/d2l/home/12345')).toBe(window.location.origin);
      expect(getBrightspaceOrigin('')).toBe(null);
    });
  });
});
