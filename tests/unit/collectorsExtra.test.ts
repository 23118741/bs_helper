import { describe, expect, it } from 'vitest';
import { collectCourseData } from '@/services/brightspace/collectors';
import { collectAttachmentTopics } from '@/services/brightspace/documentLoader';
import { buildContextBundle, serializeToMarkdown } from '@/services/context/contextSerializer';
import { createFullContextSelection } from '@/types/parser';

const routes: Record<string, any> = {
  '/users/whoami': { Identifier: '77' },
  '/overview': { Title: 'O', Body: { Text: 'hi' } },
  '/content/toc': {
    Modules: [
      {
        ModuleId: 1,
        Title: 'Week 1',
        Description: { Text: 'Intro week' },
        Topics: [{ TopicId: 5, Title: 'Video lecture', TypeIdentifier: 'Link', Url: 'https://yt/x', Description: { Text: 'watch first' } }],
      },
    ],
  },
  '/news/': [],
  '/dropbox/folders/1/feedback/User/77': {
    Score: 7,
    OutOf: 10,
    IsGraded: true,
    Feedback: { Text: 'Good analysis, weak sources' },
    RubricAssessments: [{ Name: 'Essay', OverallScore: '7', CriteriaOutcome: [{ CriterionName: 'Sources', LevelName: 'Fair', Score: 1 }] }],
    Files: [{ FileId: 9, FileName: 'annotated.pdf' }],
  },
  '/dropbox/folders/1/submissions/': [{ Entity: { EntityId: 77 }, Status: 'Submitted', Submissions: [{ SubmissionDate: '2026-01-01', Files: [{ FileId: 3, FileName: 'essay.docx' }] }] }],
  '/dropbox/folders/': [{ Id: 1, Name: 'Essay', Attachments: [{ FileId: 4, FileName: 'brief.pdf' }] }],
  '/quizzes/3/attempts/': { Objects: [{ UserId: 77, AttemptNumber: 1, Score: 8, PossibleScore: 10 }] },
  '/quizzes/3': { Description: { Text: 'Midterm' }, TimeLimit: { IsEnforced: true, TimeLimitValue: 60 } },
  '/quizzes/': [{ QuizId: 3, Name: 'Midterm' }],
  '/calendar/events/': [],
  '/grades/values/myGradeValues/': [{ GradeObjectIdentifier: 11, GradeObjectName: 'Essay', PointsNumerator: 7, PointsDenominator: 10, DisplayedGrade: '70%' }],
  '/grades/11/values/77': { Comments: { Content: 'Nice', Type: 'Text' } },
  '/grades/final/values/77': { DisplayedGrade: 'B', PointsNumerator: 70, PointsDenominator: 100 },
  '/grades/': [{ Id: 11, Name: 'Essay', MaxPoints: 10, Weight: 30 }],
  '/enrollments/orgUnits/42/users/': { PagingInfo: { HasMoreItems: false }, Items: [
    { Role: { Name: 'Instructor' }, User: { DisplayName: 'Dr. Smith', EmailAddress: 's@uni.nl' } },
    { Role: { Name: 'Student' }, User: { DisplayName: 'Other Student' } },
  ] },
  '/discussions/forums/1/topics/2/posts/': [{ PostingUserId: 77, Message: { Text: 'My post' } }, { PostingUserId: 1, PostingUserDisplayName: 'Dr. Smith', Message: { Text: 'Reply' } }],
  '/discussions/forums/1/topics/': [{ TopicId: 2, Name: 'Q&A' }],
  '/discussions/forums/': [{ ForumId: 1, Name: 'General' }],
};

const client = {
  getVersions: async () => ({ le: '1.74', lp: '1.45' }),
  async get<T>(path: string): Promise<T> {
    const clean = path.split('?')[0];
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => clean.endsWith(k) || clean.includes(k));
    if (!key) throw new Error('404 Not found');
    return routes[key];
  },
};

describe('collector extras', () => {
  it('collects feedback, attempts, grade details, staff, discussions and serializes them', async () => {
    const data = await collectCourseData('42', { valenceClient: client as any, skipDom: true });
    const a = data.assignments![0];
    expect(a.feedback?.score).toBe(7);
    expect(a.feedback?.rubricAssessments?.[0].criteria[0].criterion).toBe('Sources');
    expect(a.attachments?.[0].downloadUrl).toContain('/dropbox/folders/1/attachments/4');
    expect(a.submissions?.[0].fileNames).toEqual(['essay.docx']);
    expect(data.quizzes![0].attempts?.[0].score).toBe(8);
    expect(data.quizzes![0].timeLimitMinutes).toBe(60);
    expect(data.grades![0].weight).toBe(30);
    expect(data.grades![0].comments).toBe('Nice');
    expect(data.finalGrade?.displayedGrade).toBe('B');
    expect(data.instructors).toEqual([{ name: 'Dr. Smith', role: 'Instructor', email: 's@uni.nl' }]);
    expect(data.discussions![0].posts[0].mine).toBe(true);

    const topics = collectAttachmentTopics(data);
    expect(topics.map((t) => t.topicId).sort()).toEqual(['att:assignment:1:4', 'att:feedback:1:9']);

    const md = serializeToMarkdown(
      buildContextBundle(data, createFullContextSelection(data), [
        { topicId: 'att:feedback:1:9', filename: 'annotated.pdf', fileType: 'pdf', extractedText: '[Page 1]\n\nUse more sources', metadata: { extractedAt: 0 } },
      ])
    );
    expect(md).toContain('Course Structure');
    expect(md).toContain('Video lecture');
    expect(md).toContain('watch first');
    expect(md).toContain('Good analysis, weak sources');
    expect(md).toContain('Use more sources');
    expect(md).toContain('Assignments > Essay > Instructor feedback file');
    expect(md).toContain('Teaching Staff');
    expect(md).toContain('Final grade');
    expect(md).toContain('Q&A');
  });
});
