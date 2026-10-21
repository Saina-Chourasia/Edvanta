// Automated Integration Tests for Phase 1: AI Academic Assistant
// Tests authentication, role-based behavior, input validation, missing API key handling, and rate limiting

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import AIService from '../src/services/ai.service.js';

describe('Phase 1: AI Academic Assistant Integration Tests', () => {
  let server;
  let baseUrl;
  let adminToken;
  let facultyToken;
  let studentToken;

  before(async () => {
    // Start ephemeral server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    // Obtain tokens for testing
    const [admRes, facRes, stuRes] = await Promise.all([
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'admin@edvanta.msot.edu', password: 'edvanta123' })
      }),
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'faculty.cs@edvanta.msot.edu', password: 'edvanta123' })
      }),
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'student.aarav@edvanta.msot.edu', password: 'edvanta123' })
      })
    ]);

    const admData = await admRes.json();
    const facData = await facRes.json();
    const stuData = await stuRes.json();

    adminToken = admData.token;
    facultyToken = facData.token;
    studentToken = stuData.token;
  });

  after(() => {
    if (server) server.close();
  });

  // 1. Authentication Guards
  test('POST /api/ai/chat rejects unauthenticated requests with HTTP 401', async () => {
    const res = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Explain the CAP theorem' })
    });
    assert.equal(res.status, 401, 'Should return HTTP 401 Unauthorized');
  });

  test('GET /api/ai/status rejects unauthenticated requests with HTTP 401', async () => {
    const res = await fetch(`${baseUrl}/api/ai/status`);
    assert.equal(res.status, 401, 'Should return HTTP 401 Unauthorized');
  });

  // 2. Input Validation
  test('POST /api/ai/chat rejects empty or whitespace prompt with HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: JSON.stringify({ prompt: '   ' })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Prompt text is required/i);
  });

  test('POST /api/ai/chat rejects prompt exceeding 2500 characters with HTTP 400', async () => {
    const oversizedPrompt = 'a'.repeat(2505);
    const res = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: JSON.stringify({ prompt: oversizedPrompt })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /exceeds the maximum permitted length/i);
  });

  test('POST /api/ai/chat rejects invalid history format with HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: JSON.stringify({ prompt: 'Hello', history: 'invalid-history-string' })
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /History must be an array/i);
  });

  // 3. Status Reporting & Missing API Key Handling
  test('GET /api/ai/status reports provider configuration status without exposing keys', async () => {
    const res = await fetch(`${baseUrl}/api/ai/status`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.configured === 'boolean');
    assert.ok(data.provider);
    assert.ok(data.model);
    assert.equal(data.role, 'STUDENT');
    // Ensure secrets are not returned
    assert.equal(data.apiKey, undefined);
    assert.equal(data.key, undefined);
  });

  test('POST /api/ai/chat returns HTTP 503 when API key is missing (with clean setup instructions)', async () => {
    const origAiKey = process.env.AI_API_KEY;
    const origKey = process.env.GEMINI_API_KEY;
    const origProvider = process.env.AI_PROVIDER;

    try {
      process.env.AI_API_KEY = '';
      process.env.GEMINI_API_KEY = '';
      process.env.AI_PROVIDER = 'gemini';

      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${studentToken}`
        },
        body: JSON.stringify({ prompt: 'What is a distributed lock?' })
      });

      assert.equal(res.status, 503);
      const data = await res.json();
      assert.match(data.error, /GEMINI_API_KEY/i);
      assert.equal(data.configured, false);
      // Ensure no internal stack traces or secrets leak
      assert.equal(data.stack, undefined);
    } finally {
      process.env.AI_API_KEY = origAiKey;
      process.env.GEMINI_API_KEY = origKey;
      process.env.AI_PROVIDER = origProvider;
    }
  });

  // 4. Provider Abstraction & Role-Conditioned Completion (Mock / Offline Provider)
  test('POST /api/ai/chat processes educational requests via provider abstraction', async () => {
    const origProvider = process.env.AI_PROVIDER;
    try {
      process.env.AI_PROVIDER = 'mock';

      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${studentToken}`
        },
        body: JSON.stringify({
          prompt: 'Generate 2 practice MCQs on Binary Search algorithms',
          history: [
            { role: 'user', text: 'Hi, I need help studying.' },
            { role: 'model', text: 'Hello! What topic are you revising?' }
          ]
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.response, 'Response text must be present');
      assert.match(data.response, /MCQs/i);
      assert.equal(data.role, 'STUDENT');
      assert.equal(data.provider, 'mock');
      assert.ok(data.timestamp);

      // Verify no passwords, tokens, or hashes are exposed
      assert.equal(data.password_hash, undefined);
      assert.equal(data.jwt_secret, undefined);
    } finally {
      process.env.AI_PROVIDER = origProvider;
    }
  });

  test('POST /api/ai/chat handles Faculty lesson-planning prompts', async () => {
    const origProvider = process.env.AI_PROVIDER;
    try {
      process.env.AI_PROVIDER = 'mock';

      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${facultyToken}`
        },
        body: JSON.stringify({
          prompt: 'Create a 50-minute lesson plan for Cloud Computing Foundations'
        })
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.match(data.response, /Lesson Plan/i);
      assert.equal(data.role, 'FACULTY');
    } finally {
      process.env.AI_PROVIDER = origProvider;
    }
  });

  // 5. Rate Limiting Safety
  test('POST /api/ai/chat enforces user rate limits (max 15 requests per minute)', async () => {
    const testUserId = 'test_rate_limited_user';

    // Simulate 15 requests in the window
    for (let i = 0; i < 15; i++) {
      const allowed = AIService.checkRateLimit(testUserId);
      assert.equal(allowed, true, `Request ${i + 1} should be permitted`);
    }

    // 16th request must be rejected
    const blocked = AIService.checkRateLimit(testUserId);
    assert.equal(blocked, false, '16th request within window must be rate-limited');
  });

  // 6. Role-conditioned system instructions safety
  test('AIService.getSystemInstruction includes anti-hallucination guardrails for all roles', () => {
    const studentPrompt = AIService.getSystemInstruction('STUDENT', 'Aarav Mehta');
    assert.match(studentPrompt, /DO NOT INVENT OR GUESS live academic records/i);
    assert.match(studentPrompt, /STUDENT ROLE GUIDELINES/i);

    const facultyPrompt = AIService.getSystemInstruction('FACULTY', 'Dr. Aris Thorne');
    assert.match(facultyPrompt, /DO NOT INVENT OR GUESS live academic records/i);
    assert.match(facultyPrompt, /FACULTY ROLE GUIDELINES/i);

    const adminPrompt = AIService.getSystemInstruction('ADMIN', 'Dean Sharma');
    assert.match(adminPrompt, /DO NOT INVENT OR GUESS live academic records/i);
    assert.match(adminPrompt, /ADMINISTRATOR ROLE GUIDELINES/i);
  });

  // 7. AI_API_KEY environment variable support
  test('AIService.getConfig recognizes AI_API_KEY environment variable', () => {
    const origAIKey = process.env.AI_API_KEY;
    const origGeminiKey = process.env.GEMINI_API_KEY;
    const origOpenAIKey = process.env.OPENAI_API_KEY;
    const origProvider = process.env.AI_PROVIDER;

    try {
      delete process.env.GEMINI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      process.env.AI_PROVIDER = 'gemini';
      process.env.AI_API_KEY = 'test_ai_api_key_123';

      const config = AIService.getConfig();
      assert.equal(config.isConfigured, true);
      assert.equal(config.provider, 'gemini');
    } finally {
      process.env.AI_API_KEY = origAIKey;
      process.env.GEMINI_API_KEY = origGeminiKey;
      process.env.OPENAI_API_KEY = origOpenAIKey;
      process.env.AI_PROVIDER = origProvider;
    }
  });

  // 8. Academic context injection for Student and Faculty
  test('AIService.getAcademicContext retrieves student batch and enrolled curriculum', () => {
    const studentUser = {
      id: 'usr_stu_aarav',
      name: 'Aarav Mehta',
      role: 'STUDENT',
      campus_id: 'camp_hitech',
      batch_name: 'Batch-2026-Mirai-A'
    };

    const context = AIService.getAcademicContext(studentUser);
    assert.match(context, /VERIFIED STUDENT ACADEMIC PROFILE/i);
    assert.match(context, /Aarav Mehta/);
    assert.match(context, /Batch-2026-Mirai-A/);
    assert.match(context, /Enrolled Curriculum Subjects/i);
  });

  test('AIService.getAcademicContext retrieves faculty assigned subjects', () => {
    const facultyUser = {
      id: 'usr_fac_thorne',
      name: 'Dr. Aris Thorne',
      role: 'FACULTY',
      campus_id: 'camp_hitech'
    };

    const context = AIService.getAcademicContext(facultyUser);
    assert.match(context, /VERIFIED FACULTY INSTRUCTION PROFILE/i);
    assert.match(context, /Dr. Aris Thorne/);
    assert.match(context, /Assigned Teaching Subjects/i);
  });
});
