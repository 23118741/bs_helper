/**
 * test-page/mock-sw.js
 * Service Worker for intercepting Valence API requests in the mock environment.
 * Enables end-to-end testing of extension content scripts running in isolated worlds.
 */

const mockConfig = {
  authStatus: 200,
  gradesStatus: 200,
  rateLimitStatus: 200,
  latency: 0,
  activeCourseId: '88421',
};

const MOCK_COURSES = {
  '88421': {
    name: 'CS 450: Machine Learning',
    code: 'CS-450-2026',
    overview: {
      Title: 'CS 450: Machine Learning - Course Overview',
      Body: {
        Html: '<h2>Welcome to CS 450</h2><p>This course covers fundamental supervised and unsupervised learning algorithms including gradient descent, linear and logistic regression, neural network architectures, and backpropagation.</p>',
        Text: 'Welcome to CS 450\nThis course covers fundamental supervised and unsupervised learning algorithms including gradient descent, linear and logistic regression, neural network architectures, and backpropagation.'
      }
    },
    toc: {
      Modules: [
        {
          ModuleId: 1001,
          Title: 'Course Information & Syllabus',
          Description: { Html: '<p>Essential documentation and policies.</p>', Text: 'Essential documentation and policies.' },
          Modules: [],
          Topics: [
            { TopicId: 2001, Identifier: '2001', Title: 'CS 450 Syllabus & Schedule.pdf', TypeIdentifier: 'file', Url: '/content/enforced/88421/Syllabus.pdf' },
            { TopicId: 2002, Identifier: '2002', Title: 'Academic Integrity & Collaboration Policy.docx', TypeIdentifier: 'file', Url: '/content/enforced/88421/Integrity_Policy.docx' }
          ]
        },
        {
          ModuleId: 1002,
          Title: 'Week 1: Foundations of Optimization',
          Description: { Html: '<p>Lecture slides and math prep.</p>', Text: 'Lecture slides and math prep.' },
          Modules: [],
          Topics: [
            { TopicId: 2003, Identifier: '2003', Title: 'Lecture 1: Gradient Descent & Convex Loss.pptx', TypeIdentifier: 'file', Url: '/content/enforced/88421/Lecture1_Gradient_Descent.pptx' },
            { TopicId: 2004, Identifier: '2004', Title: 'Math Prerequisites: Vector Calculus.html', TypeIdentifier: 'html', Url: '/content/enforced/88421/Math_Prerequisites.html' }
          ]
        },
        {
          ModuleId: 1003,
          Title: 'Week 2: Neural Networks & Backprop',
          Description: { Html: '<p>Multilayer perceptrons and PyTorch.</p>', Text: 'Multilayer perceptrons and PyTorch.' },
          Modules: [],
          Topics: [
            { TopicId: 2005, Identifier: '2005', Title: 'Lecture 2: Multilayer Perceptrons & Backpropagation.pptx', TypeIdentifier: 'file', Url: '/content/enforced/88421/Lecture2_MLP.pptx' },
            { TopicId: 2006, Identifier: '2006', Title: 'Lab 1 Guide: PyTorch Tensors.pdf', TypeIdentifier: 'file', Url: '/content/enforced/88421/Lab1_PyTorch.pdf' }
          ]
        }
      ]
    },
    news: [
      { Id: 3001, Title: 'Welcome to CS 450 (Fall 2026)', Body: { Html: '<p>Please review the syllabus and install PyTorch 2.4.</p>', Text: 'Please review the syllabus and install PyTorch 2.4.' }, StartDate: '2026-09-02T08:00:00.000Z' },
      { Id: 3002, Title: 'Assignment 1 Released: Gradient Descent', Body: { Html: '<p>Assignment 1 is available in Dropbox. Due Oct 25 at 23:59.</p>', Text: 'Assignment 1 is available in Dropbox. Due Oct 25 at 23:59.' }, StartDate: '2026-10-10T12:00:00.000Z' },
      { Id: 3003, Title: 'Office Hours & TA Schedule', Body: { Html: '<p>TAs hold office hours on Mon/Wed in Turing Hall 202.</p>', Text: 'TAs hold office hours on Mon/Wed in Turing Hall 202.' }, StartDate: '2026-10-12T10:00:00.000Z' }
    ],
    dropbox: [
      {
        Id: 4001,
        Name: 'Assignment 1: Gradient Descent & Linear Regression',
        CustomInstructions: { Html: '<p>Implement batch and stochastic gradient descent in Python.</p>', Text: 'Implement batch and stochastic gradient descent in Python.' },
        DueDate: '2026-10-25T23:59:00.000Z',
        Assessment: { Rubrics: [{ Name: 'Code Correctness & Efficiency' }, { Name: 'Loss Curve Analysis' }] }
      },
      {
        Id: 4002,
        Name: 'Project Milestone 1: Proposal & Dataset Exploration',
        CustomInstructions: { Html: '<p>Submit 2-page project proposal with baseline exploration.</p>', Text: 'Submit 2-page project proposal with baseline exploration.' },
        DueDate: '2026-10-28T22:00:00.000Z',
        Assessment: { Rubrics: [{ Name: 'Proposal Quality' }] }
      }
    ],
    quizzes: [
      { QuizId: 5001, Name: 'Quiz 1: Math & Optimization Prerequisites', DueDate: '2026-10-15T23:59:00.000Z', AttemptsAllowed: 2 },
      { QuizId: 5002, Name: 'Midterm Exam (Comprehensive)', DueDate: '2026-11-05T18:00:00.000Z', AttemptsAllowed: 1 }
    ],
    calendar: [
      { CalendarEventId: 6001, Title: 'Assignment 1 Due', Description: { Text: 'Submit to Dropbox before 23:59.' }, StartDateTime: '2026-10-25T23:59:00.000Z' },
      { CalendarEventId: 6002, Title: 'Project Milestone 1 Due', Description: { Text: 'Submit team proposal via Dropbox.' }, StartDateTime: '2026-10-28T22:00:00.000Z' },
      { CalendarEventId: 6003, Title: 'Midterm Review Session', Description: { Text: 'Live review on Zoom.' }, StartDateTime: '2026-11-03T15:00:00.000Z', EndDateTime: '2026-11-03T16:30:00.000Z' }
    ],
    grades: [
      { GradeObjectIdentifier: 7001, GradeObjectName: 'Quiz 1: Math & Optimization', PointsNumerator: 19, PointsDenominator: 20, GradeText: '95%', Comments: { Text: 'Great mastery of vector derivatives.' } },
      { GradeObjectIdentifier: 7002, GradeObjectName: 'Assignment 1: Gradient Descent', PointsNumerator: 92, PointsDenominator: 100, GradeText: '92%', Comments: { Text: 'Clean vectorized code; check learning rate schedule.' } }
    ]
  },
  '99102': {
    name: 'CS 480: Distributed Systems',
    code: 'CS-480-2026',
    overview: {
      Title: 'CS 480: Distributed Systems Overview',
      Body: {
        Html: '<p>Concurrency, consensus, Paxos, Raft, and distributed storage systems.</p>',
        Text: 'Concurrency, consensus, Paxos, Raft, and distributed storage systems.'
      }
    },
    toc: {
      Modules: [
        {
          ModuleId: 1101,
          Title: 'Week 1: Clocks, Time & Ordering',
          Description: { Html: '<p>Logical clocks and happens-before relations.</p>', Text: 'Logical clocks and happens-before relations.' },
          Modules: [],
          Topics: [
            { TopicId: 2101, Identifier: '2101', Title: 'CS 480 Syllabus & Reading List.pdf', TypeIdentifier: 'file', Url: '/content/enforced/99102/Syllabus_CS480.pdf' },
            { TopicId: 2102, Identifier: '2102', Title: 'Lamport Clocks & Vector Clocks.pptx', TypeIdentifier: 'file', Url: '/content/enforced/99102/Lecture1_Clocks.pptx' }
          ]
        },
        {
          ModuleId: 1102,
          Title: 'Week 2: Consensus & Raft Protocol',
          Description: { Html: '<p>Leader election and log replication.</p>', Text: 'Leader election and log replication.' },
          Modules: [],
          Topics: [
            { TopicId: 2103, Identifier: '2103', Title: 'In Search of an Understandable Consensus Algorithm (Raft).pdf', TypeIdentifier: 'file', Url: '/content/enforced/99102/Raft_Paper.pdf' },
            { TopicId: 2104, Identifier: '2104', Title: 'Lab 1: MapReduce in Go.docx', TypeIdentifier: 'file', Url: '/content/enforced/99102/Lab1_MapReduce.docx' }
          ]
        }
      ]
    },
    news: [
      { Id: 3101, Title: 'Go 1.23 Required for Distributed Labs', Body: { Html: '<p>Ensure Go 1.23+ is installed before cloning the Raft lab repository.</p>', Text: 'Ensure Go 1.23+ is installed before cloning the Raft lab repository.' }, StartDate: '2026-09-03T09:00:00.000Z' }
    ],
    dropbox: [
      {
        Id: 4101,
        Name: 'Lab 1: Distributed MapReduce Coordinator & Worker',
        CustomInstructions: { Html: '<p>Implement RPC worker coordination and fault recovery.</p>', Text: 'Implement RPC worker coordination and fault recovery.' },
        DueDate: '2026-10-27T23:59:00.000Z',
        Assessment: { Rubrics: [{ Name: 'Fault Tolerance & Race Detector' }] }
      }
    ],
    quizzes: [
      { QuizId: 5101, Name: 'Quiz 1: Lamport Timestamps & Causal Ordering', DueDate: '2026-10-22T23:59:00.000Z', AttemptsAllowed: 2 }
    ],
    calendar: [
      { CalendarEventId: 6101, Title: 'Lab 1 Due: MapReduce', Description: { Text: 'Pass all go test -race checks.' }, StartDateTime: '2026-10-27T23:59:00.000Z' }
    ],
    grades: [
      { GradeObjectIdentifier: 7101, GradeObjectName: 'Quiz 1: Lamport Timestamps', PointsNumerator: 18, PointsDenominator: 20, GradeText: '90%', Comments: { Text: 'Solid vector clock trace.' } }
    ]
  },
  '77005': {
    name: 'MATH 320: Linear Algebra',
    code: 'MATH-320-2026',
    overview: {
      Title: 'MATH 320: Linear Algebra Overview',
      Body: {
        Html: '<p>Vector spaces, linear transformations, eigenvalues, eigenvectors, and SVD.</p>',
        Text: 'Vector spaces, linear transformations, eigenvalues, eigenvectors, and SVD.'
      }
    },
    toc: {
      Modules: [
        {
          ModuleId: 1201,
          Title: 'Unit 1: Vector Spaces & Subspaces',
          Description: { Html: '<p>Basis, dimension, and rank-nullity theorem.</p>', Text: 'Basis, dimension, and rank-nullity theorem.' },
          Modules: [],
          Topics: [
            { TopicId: 2201, Identifier: '2201', Title: 'MATH 320 Course Syllabus.pdf', TypeIdentifier: 'file', Url: '/content/enforced/77005/Syllabus_MATH320.pdf' },
            { TopicId: 2202, Identifier: '2202', Title: 'Lecture Notes: Nullspace, Column Space & Rank.pdf', TypeIdentifier: 'file', Url: '/content/enforced/77005/Notes_Subspaces.pdf' }
          ]
        },
        {
          ModuleId: 1202,
          Title: 'Unit 2: Eigenvalues & Singular Value Decomposition',
          Description: { Html: '<p>Diagonalization and spectral theorem.</p>', Text: 'Diagonalization and spectral theorem.' },
          Modules: [],
          Topics: [
            { TopicId: 2203, Identifier: '2203', Title: 'Slides: Spectral Theorem & SVD Applications.pptx', TypeIdentifier: 'file', Url: '/content/enforced/77005/SVD_Slides.pptx' },
            { TopicId: 2204, Identifier: '2204', Title: 'Problem Set 3: Characteristic Polynomials.pdf', TypeIdentifier: 'file', Url: '/content/enforced/77005/ProblemSet3.pdf' }
          ]
        }
      ]
    },
    news: [
      { Id: 3201, Title: 'Midterm Formula Sheet Policy', Body: { Html: '<p>No calculators needed; all arithmetic is small-integer.</p>', Text: 'No calculators needed; all arithmetic is small-integer.' }, StartDate: '2026-09-05T10:00:00.000Z' }
    ],
    dropbox: [
      {
        Id: 4201,
        Name: 'Problem Set 3: Eigenvalues & Diagonalization',
        CustomInstructions: { Html: '<p>Submit typeset LaTeX or clear scan as PDF.</p>', Text: 'Submit typeset LaTeX or clear scan as PDF.' },
        DueDate: '2026-10-29T23:59:00.000Z',
        Assessment: { Rubrics: [{ Name: 'Proof Rigor & Completeness' }] }
      }
    ],
    quizzes: [
      { QuizId: 5201, Name: 'Concept Check: Orthogonality & Gram-Schmidt', DueDate: '2026-10-24T23:59:00.000Z', AttemptsAllowed: 3 }
    ],
    calendar: [
      { CalendarEventId: 6201, Title: 'Problem Set 3 Due', Description: { Text: 'Upload PDF to Dropbox.' }, StartDateTime: '2026-10-29T23:59:00.000Z' }
    ],
    grades: [
      { GradeObjectIdentifier: 7201, GradeObjectName: 'Problem Set 1: Gaussian Elimination', PointsNumerator: 48, PointsDenominator: 50, GradeText: '96%', Comments: { Text: 'Clear row reduction steps.' } }
    ]
  }
};

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'UPDATE_MOCK_CONFIG') {
    Object.assign(mockConfig, event.data.payload);
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept Brightspace Valence API endpoints
  if (url.pathname.includes('/d2l/api/')) {
    event.respondWith(handleMockValenceRequest(url, event.request));
  }
});

async function handleMockValenceRequest(url, request) {
  // Apply simulated latency if configured
  if (mockConfig.latency > 0) {
    await new Promise((resolve) => setTimeout(resolve, mockConfig.latency));
  }

  // Handle Rate Limiting
  if (mockConfig.rateLimitStatus === 429) {
    return new Response(JSON.stringify({ error: 'Too Many Requests', retryAfter: 60 }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  // Handle Authentication failure
  if (mockConfig.authStatus === 401) {
    return new Response('<html><body><h1>401 Unauthorized</h1><p>Please log in</p></body></html>', {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const path = url.pathname;
  const pathMatch = path.match(/\/d2l\/api\/le\/[^/]+\/(\d+)\//);
  const courseId = (pathMatch && pathMatch[1]) || mockConfig.activeCourseId || '88421';
  const course = MOCK_COURSES[courseId] || MOCK_COURSES[mockConfig.activeCourseId] || MOCK_COURSES['88421'];

  // 1. Version discovery endpoint
  if (path.includes('/d2l/api/versions/')) {
    return jsonResponse([
      { ProductCode: 'lp', LatestVersion: '1.45' },
      { ProductCode: 'le', LatestVersion: '1.74' },
    ]);
  }

  // 2. Enrolled courses endpoint
  if (path.includes('/enrollments/myenrollments/')) {
    const items = Object.entries(MOCK_COURSES).map(([id, c]) => ({
      OrgUnit: {
        Id: parseInt(id, 10),
        Name: c.name,
        Code: c.code,
        Type: { Id: 3, Code: 'Course Offering', Name: 'Course Offering' },
      },
      Access: { IsActive: true, StartDate: null, EndDate: null },
    }));
    return jsonResponse({ Items: items, PagingInfo: { HasMoreItems: false } });
  }

  // 3. Course Overview
  if (path.includes('/overview')) {
    return jsonResponse(course.overview);
  }

  // 4. Content TOC
  if (path.includes('/content/toc')) {
    return jsonResponse(course.toc);
  }

  // 5. Announcements / News
  if (path.includes('/news/')) {
    return jsonResponse(course.news);
  }

  // 6. Dropbox / Assignments
  if (path.includes('/dropbox/folders/')) {
    return jsonResponse(course.dropbox);
  }

  // 7. Quizzes
  if (path.includes('/quizzes/')) {
    return jsonResponse(course.quizzes);
  }

  // 8. Calendar Events
  if (path.includes('/calendar/events/')) {
    return jsonResponse(course.calendar);
  }

  // 9. Grades
  if (path.includes('/grades/values/myGradeValues/')) {
    if (mockConfig.gradesStatus === 403) {
      return new Response(JSON.stringify({ error: 'Grades access restricted by instructor (HTTP 403 Forbidden)' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return jsonResponse(course.grades);
  }

  // 10. Topic File Download
  if (path.includes('/content/topics/') && path.endsWith('/file')) {
    return new Response('Sample document extracted content for offline test environment', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Fallback 404
  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
