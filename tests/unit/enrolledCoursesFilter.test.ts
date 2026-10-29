import { describe, expect, it } from 'vitest';
import { collectEnrolledCourses, hasOrgUnitTypes, isCourseOffering, mainCourses } from '@/services/brightspace/collectors';
import type { EnrolledCourse } from '@/types/brightspace';

const unit = (Id: number, Name: string, type: [number, string]) => ({
  OrgUnit: { Id, Name, Code: `C${Id}`, Type: { Id: type[0], Code: type[1], Name: type[1] } },
  Access: { IsActive: true },
});

// what /enrollments/myenrollments/ returns: the courses plus everything around and inside them
const enrollments = [
  unit(6606, 'University of Example', [1, 'Organization']),
  unit(7001, '2026 Fall', [5, 'Semester']),
  unit(7002, 'Faculty of Science', [203, 'Faculty']),
  unit(7003, 'Statistics (template)', [2, 'Course Template']),
  unit(101, 'Statistics', [3, 'Course Offering']),
  unit(102, 'Machine Learning', [3, 'Course Offering']),
  unit(8001, 'Statistics - Group 4', [4, 'Group']),
  unit(8002, 'Machine Learning - Section A', [6, 'Section']),
];

const client = (items: unknown[]) => ({
  get: async () => ({ Items: items, PagingInfo: { HasMoreItems: false } }),
});

describe('the course dropdown lists only courses', () => {
  it('drops the organisation, semesters, faculties, templates, groups and sections', async () => {
    const courses = await collectEnrolledCourses(client(enrollments) as any);
    expect(courses.map((c) => c.name)).toEqual(['Statistics', 'Machine Learning']);
    expect(courses.every((c) => c.typeId === 3)).toBe(true);
  });

  it('recognises a course by its type name too (institutions can renumber types)', () => {
    expect(isCourseOffering({ orgUnitId: '1', name: 'X', code: '', isActive: true, typeId: 42, typeName: 'Course Offering' })).toBe(true);
    expect(isCourseOffering({ orgUnitId: '1', name: 'X', code: '', isActive: true, typeId: 4, typeName: 'Group' })).toBe(false);
  });

  it('a course list saved by an older version (no types) is discovered again', () => {
    expect(hasOrgUnitTypes([{ orgUnitId: '1', name: 'X', code: '', isActive: true }])).toBe(false);
    expect(hasOrgUnitTypes([{ orgUnitId: '1', name: 'X', code: '', isActive: true, typeId: 3 }])).toBe(true);
  });
});

describe('only the main courses: current courses the student can open', () => {
  const NOW = Date.parse('2026-10-23T12:00:00Z');
  const course = (name: string, over: Partial<EnrolledCourse> = {}): EnrolledCourse => ({
    orgUnitId: name, name, code: '', isActive: true, typeId: 3, typeName: 'Course Offering', ...over,
  });

  it('drops inactive, inaccessible and ended courses and untyped entries', () => {
    const list = [
      course('Current'),
      course('Ends later', { endDate: '2027-01-31T00:00:00Z' }),
      course('Inactive', { isActive: false }),
      course('No access', { canAccess: false }),
      course('Ended', { endDate: '2025-06-30T00:00:00Z' }),
      { orgUnitId: 'x', name: 'Untyped', code: '', isActive: true },
      course('Group', { typeId: 4, typeName: 'Group' }),
    ];
    expect(mainCourses(list, NOW).map((c) => c.name)).toEqual(['Current', 'Ends later']);
  });

  it('between semesters (nothing current) it still shows the courses', () => {
    const list = [course('Ended', { endDate: '2025-06-30T00:00:00Z' }), course('Group', { typeId: 4, typeName: 'Group' })];
    expect(mainCourses(list, NOW).map((c) => c.name)).toEqual(['Ended']);
  });

  it('discovery reads CanAccess and leaves inaccessible courses out', async () => {
    const items = [
      unit(101, 'Statistics', [3, 'Course Offering']),
      { ...unit(103, 'Old sandbox', [3, 'Course Offering']), Access: { IsActive: true, CanAccess: false } },
    ];
    const courses = await collectEnrolledCourses(client(items) as any);
    expect(courses.map((c) => c.name)).toEqual(['Statistics']);
  });
});
