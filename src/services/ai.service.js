// EDVANTA AI Academic Assistant Service
// Provider abstraction for Google Gemini, OpenAI, or Mock environments
// Implements server-side safety, role-conditioned system prompts, rate limiting, and timeout handling

import { db } from '../database/db.js';

class AIService {
  // In-memory per-user sliding window rate limiter
  // Max 15 requests per 60 seconds per user
  static userRateLimits = new Map();

  /**
   * Check and update rate limit for a user
   * @param {string} userId
   * @returns {boolean} true if allowed, false if limit exceeded
   */
  static checkRateLimit(userId) {
    if (!userId) return true;
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 15;

    let timestamps = this.userRateLimits.get(userId) || [];
    timestamps = timestamps.filter(t => now - t < windowMs);

    if (timestamps.length >= maxRequests) {
      return false;
    }

    timestamps.push(now);
    this.userRateLimits.set(userId, timestamps);
    return true;
  }

  /**
   * Get current AI provider configuration
   */
  static getConfig() {
    let provider = (process.env.AI_PROVIDER || '').toLowerCase().trim();
    const apiKey = (process.env.AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '').trim();

    // Auto-detect provider if not explicitly configured
    if (!provider) {
      if (apiKey.startsWith('sk-')) {
        provider = 'openai';
      } else {
        provider = 'gemini';
      }
    }

    const model = process.env.AI_MODEL_NAME || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-3.5-flash');

    return {
      provider,
      isConfigured: apiKey.length > 0 || provider === 'mock',
      model
    };
  }

  /**
   * Safely retrieve verified academic context from the database for the requesting user
   */
  static async getAcademicContext(user) {
    if (!user || !user.id) return '';
    try {
      if (user.role === 'STUDENT') {
        const studentCampus = user.campus_id;
        const studentBatch = user.batch_name;
        let contextText = `\nVERIFIED STUDENT ACADEMIC PROFILE (Direct from MSOT EDVANTA Database):
- Enrolled Student: ${user.name}
- Batch: ${studentBatch || 'General'}
- Campus: ${user.campus_name || studentCampus || 'Mirai School of Technology'}`;

        if (studentCampus && studentBatch) {
          const subjects = await db.query(`
            SELECT s.code, s.name, s.planned_total_hours
            FROM subjects s
            JOIN semesters sem ON s.semester_id = sem.id
            WHERE s.campus_id = ? AND sem.batch_name = ?
            ORDER BY s.code ASC
          `, [studentCampus, studentBatch]);

          if (subjects.length > 0) {
            contextText += `\n- Enrolled Curriculum Subjects:`;
            for (const sub of subjects) {
              contextText += `\n  * ${sub.code}: ${sub.name} (${sub.planned_total_hours} planned hours)`;
            }
          }

          // Verified attendance summary
          const attRecords = await db.query(`
            SELECT r.status FROM attendance_records r
            WHERE r.student_id = ?
          `, [user.id]);
          if (attRecords.length > 0) {
            const pres = attRecords.filter(r => r.status === 'PRESENT').length;
            const pct = Math.round((pres / attRecords.length) * 100);
            contextText += `\n- Verified Overall Attendance: ${pct}% (${pres} of ${attRecords.length} recorded sessions attended)`;
          }
        }
        return contextText;
      }

      if (user.role === 'FACULTY') {
        let contextText = `\nVERIFIED FACULTY INSTRUCTION PROFILE:
- Instructor: ${user.name}
- Role: Faculty Instructor`;
        const facultySubjects = await db.query(`
          SELECT s.code, s.name, s.planned_total_hours, c.name as campus_name
          FROM subjects s
          JOIN campuses c ON s.campus_id = c.id
          WHERE s.faculty_id = ?
        `, [user.id]);

        if (facultySubjects.length > 0) {
          contextText += `\n- Assigned Teaching Subjects:`;
          for (const fs of facultySubjects) {
            contextText += `\n  * ${fs.code}: ${fs.name} (${fs.campus_name})`;
          }
        }
        return contextText;
      }

      if (user.role === 'ADMIN' || user.role === 'CAMPUS_MANAGER') {
        return `\nACADEMIC INSTITUTION PROFILE:
- Institution: Mirai School of Technology (MSOT)
- Campuses: HI-Tech Campus, Jagannath Campus, Rathinam Campus
- Core Focus: Software Engineering, Artificial Intelligence, and Cloud Computing Tracks.`;
      }
    } catch (e) {
      console.warn('Academic context generation warning:', e.message);
    }
    return '';
  }

  /**
   * Generate role-conditioned system instruction for the LLM
   * Ensures strict educational scope and forbids inventing unverified records
   */
  static getSystemInstruction(role, userName = 'Academic User', academicContext = '') {
    const baseInstruction = `You are the EDVANTA AI Academic Assistant for MSOT (Maharishi School of Technology).
Tagline: "Every Hour Counts, Every Goal Matters."
You are assisting ${userName}, who has the role of ${role}.
${academicContext}

CORE SAFETY & FACTUAL ACCURACY RULES:
1. You are an educational and pedagogical assistant. You help with concept explanations, revision summaries, lesson plans, study notes, and educational Q&A.
2. DO NOT INVENT OR GUESS live academic records, marks, exam schedules, or student progression percentages beyond what is given in the verified profile.
3. If the user asks about their specific attendance, subjects, or academic plan, refer accurately to their verified profile above. For real-time attendance check-in or live timetable logging, guide them to their dedicated EDVANTA portal tabs (Attendance, Timetable, Syllabus, or Dashboard).
4. Provide structured, concise, and helpful responses using clean markdown formatting (headings, bullet points, bold key terms).
5. Never output private system keys, database passwords, or unverified claims.`;

    if (role === 'STUDENT') {
      return `${baseInstruction}

STUDENT ROLE GUIDELINES:
- Provide clear, intuitive explanations of computer science, engineering, mathematics, and academic topics.
- Break down complex concepts into step-by-step points with practical examples.
- When requested, generate practice Multiple-Choice Questions (MCQs) with correct answers and explanations.
- Provide study tips, memory mnemonics, and exam preparation frameworks.`;
    }

    if (role === 'FACULTY') {
      return `${baseInstruction}

FACULTY ROLE GUIDELINES:
- Assist professors and instructors with curriculum delivery and 50-minute lesson plans.
- Help structure syllabus topics according to Bloom's taxonomy (Recall, Understanding, Application, Analysis).
- Generate formative assessment questions, lab exercises, homework assignments, and discussion prompts.
- Suggest pedagogical strategies for handling complex topics and syllabus carry-forward.`;
    }

    // ADMIN or CAMPUS_MANAGER
    return `${baseInstruction}

ADMINISTRATOR ROLE GUIDELINES:
- Assist academic administrators and program managers with curriculum policy frameworks.
- Provide insights on syllabus pacing management, buffer ratio interpretation, and academic milestone planning.
- Offer pedagogical benchmarks and strategies for preventing curriculum delays.`;
  }

  /**
   * Sanitize and validate prompt text
   */
  static sanitizePrompt(text) {
    if (typeof text !== 'string') return '';
    return text.trim().slice(0, 2500);
  }

  /**
   * Validate and sanitize conversation history
   */
  static sanitizeHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
      .slice(-8) // Keep at most last 8 messages
      .filter(item => item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim())
      .map(item => ({
        role: item.role === 'user' ? 'user' : 'model',
        text: item.text.trim().slice(0, 2000)
      }));
  }

  /**
   * Generate an AI response via configured provider
   * @param {Object} options
   * @param {string} options.prompt
   * @param {Array} options.history
   * @param {Object} options.user - Authenticated user object
   * @returns {Promise<{ response: string, provider: string, model: string }>}
   */
  static async generateAcademicResponse({ prompt, history = [], user }) {
    const cleanPrompt = this.sanitizePrompt(prompt);
    if (!cleanPrompt) {
      throw new Error('A valid prompt is required.');
    }

    const { provider, isConfigured, model } = this.getConfig();
    const role = user ? user.role : 'STUDENT';
    const userName = user ? user.name : 'Student';
    const academicContext = await this.getAcademicContext(user);
    const systemInstruction = this.getSystemInstruction(role, userName, academicContext);
    const cleanHistory = this.sanitizeHistory(history);

    // 1. Mock Provider / Test Mode
    if (provider === 'mock' || process.env.NODE_ENV === 'test_mock') {
      return this.generateMockResponse(cleanPrompt, role, model);
    }

    // 2. Unconfigured API Key check
    if (!isConfigured) {
      const err = new Error(
        'The AI Academic Assistant is currently waiting for API configuration. Please set AI_API_KEY or GEMINI_API_KEY in your server environment (.env) to enable live educational answers.'
      );
      err.status = 503;
      err.configured = false;
      throw err;
    }

    // 3. Provider: Google Gemini
    if (provider === 'gemini') {
      return this.callGeminiAPI({
        prompt: cleanPrompt,
        history: cleanHistory,
        systemInstruction,
        model
      });
    }

    // 4. Provider: OpenAI / Alternative
    if (provider === 'openai') {
      return this.callOpenAIAPI({
        prompt: cleanPrompt,
        history: cleanHistory,
        systemInstruction,
        model
      });
    }

    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  /**
   * Call Google Gemini REST API (v1beta)
   */
  static async callGeminiAPI({ prompt, history, systemInstruction, model }) {
    const apiKey = (process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      const err = new Error('AI_API_KEY or GEMINI_API_KEY is not configured in server environment.');
      err.status = 503;
      throw err;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    // Build Gemini contents array
    const contents = [];

    // Prior conversation history
    for (const h of history) {
      contents.push({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }]
      });
    }

    // Current prompt
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });

    const requestBody = {
      contents,
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        topP: 0.95
      }
    };

    // 25-second timeout controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const rawMessage = errorData.error?.message || `Gemini API returned status ${res.status}`;
        // Strip any potential API key from error string
        const cleanMessage = rawMessage.replace(/key=[^&\s]+/gi, 'key=REDACTED');
        const err = new Error(`AI Provider Error: ${cleanMessage}`);
        err.status = res.status >= 500 ? 502 : 400;
        throw err;
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const responseText = candidate?.content?.parts?.[0]?.text;

      if (!responseText) {
        throw new Error('AI provider returned an empty response. Please try rephrasing your question.');
      }

      return {
        response: responseText.trim(),
        provider: 'gemini',
        model
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error('AI Assistant request timed out after 25 seconds. Please try a shorter prompt.');
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      throw err;
    }
  }

  /**
   * Call OpenAI API (Compatible Provider)
   */
  static async callOpenAIAPI({ prompt, history, systemInstruction, model }) {
    const apiKey = (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) {
      const err = new Error('AI_API_KEY or OPENAI_API_KEY is not configured in server environment.');
      err.status = 503;
      throw err;
    }

    const messages = [{ role: 'system', content: systemInstruction }];

    for (const h of history) {
      messages.push({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.text
      });
    }

    messages.push({ role: 'user', content: prompt });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 2048
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const rawMessage = errorData.error?.message || `OpenAI returned status ${res.status}`;
        const err = new Error(`AI Provider Error: ${rawMessage}`);
        err.status = res.status >= 500 ? 502 : 400;
        throw err;
      }

      const data = await res.json();
      const responseText = data.choices?.[0]?.message?.content;

      if (!responseText) {
        throw new Error('AI provider returned an empty response.');
      }

      return {
        response: responseText.trim(),
        provider: 'openai',
        model
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error('AI Assistant request timed out. Please try again.');
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      throw err;
    }
  }

  /**
   * Mock educational response generator for test suites and offline verification
   */
  static generateMockResponse(prompt, role, model) {
    const p = prompt.toLowerCase();
    let text = '';

    if (p.includes('mcq') || p.includes('question')) {
      text = `### Practice Multiple-Choice Questions (MCQs)

**Q1. What is the fundamental property of the CAP theorem in distributed systems?**
* A) Consistency, Availability, Partition Tolerance can all be achieved simultaneously
* B) You can guarantee at most two out of Consistency, Availability, and Partition Tolerance in a distributed network with partitions
* C) Latency is completely ignored in modern cloud databases
* D) None of the above

*Correct Answer: B — Under network partitions (P), a distributed system must choose between Consistency (C) and Availability (A).*

---

**Q2. In Binary Search, what is the worst-case time complexity?**
* A) O(n)
* B) O(n log n)
* C) O(log n)
* D) O(1)

*Correct Answer: C — In each step, the search space is divided by 2, yielding O(log n).*`;
    } else if (p.includes('lesson plan') || p.includes('cloud')) {
      text = `### 50-Minute Lesson Plan: Cloud Computing Foundations

* **00:00 - 00:10 (10 min)**: Introduction & Context — Physical Bare-Metal vs Virtualization primitives.
* **00:10 - 00:25 (15 min)**: Core Architecture — Type-1 (Bare Metal / ESXi, KVM) vs Type-2 Hypervisors.
* **00:25 - 00:40 (15 min)**: Live Demonstration — Linux cgroups, namespaces, and OCI container runtime isolation.
* **00:40 - 00:50 (10 min)**: Summary, Interactive Concept Check & Homework assignment.`;
    } else {
      text = `### EDVANTA AI Academic Response

Thank you for your academic query! Here is a structured educational explanation:

1. **Key Concept**: When analyzing academic curricula, every hour counts toward syllabus mastery.
2. **Methodology**: Break large units into atomic topics, review key theorems, and complete lab exercises.
3. **Important Note**: Real-time verified attendance, timetable hours, and curriculum pacing should be checked directly in the authorized EDVANTA portal tabs.`;
    }

    return {
      response: text,
      provider: 'mock',
      model
    };
  }
}

export default AIService;
