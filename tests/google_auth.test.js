// Integration Tests for Real Google OAuth 2.0 / OpenID Connect Authentication

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import { db } from '../src/database/db.js';

describe('Priority 3: Real Google OAuth 2.0 / OpenID Connect Authentication Tests', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  // 1. Google OAuth status endpoint
  test('GET /api/auth/google/status reports status safely without leaking secrets', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.provider, 'google');
    assert.ok(typeof data.configured === 'boolean');
    assert.ok(data.callback_url);
    // Secrets must never be exposed
    assert.equal(data.client_secret, undefined);
    assert.equal(data.secret, undefined);
  });

  // 2. Unconfigured credentials redirect cleanly to frontend error notice
  test('GET /api/auth/google redirects to frontend with google_unconfigured when credentials are not set', async () => {
    const origId = process.env.GOOGLE_CLIENT_ID;
    const origSecret = process.env.GOOGLE_CLIENT_SECRET;

    try {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const res = await fetch(`${baseUrl}/api/auth/google`, {
        redirect: 'manual'
      });

      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location);
      assert.match(location, /\/\?auth_error=google_unconfigured/);
    } finally {
      process.env.GOOGLE_CLIENT_ID = origId;
      process.env.GOOGLE_CLIENT_SECRET = origSecret;
    }
  });

  // 3. When configured, GET /api/auth/google sets CSRF cookie and redirects to Google OAuth endpoint
  test('GET /api/auth/google redirects to official Google accounts endpoint with state and sets oauth_state cookie', async () => {
    const origId = process.env.GOOGLE_CLIENT_ID;
    const origSecret = process.env.GOOGLE_CLIENT_SECRET;
    const origCb = process.env.GOOGLE_CALLBACK_URL;

    try {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id-12345.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret-abcde';
      process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback';

      const res = await fetch(`${baseUrl}/api/auth/google`, {
        redirect: 'manual'
      });

      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location);
      assert.match(location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);

      // Verify OAuth parameters
      const url = new URL(location);
      assert.equal(url.searchParams.get('client_id'), 'test-client-id-12345.apps.googleusercontent.com');
      assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/auth/google/callback');
      assert.equal(url.searchParams.get('response_type'), 'code');
      assert.match(url.searchParams.get('scope'), /openid/);
      assert.match(url.searchParams.get('scope'), /email/);
      assert.ok(url.searchParams.get('state'), 'CSRF state must be included');

      // Verify oauth_state cookie is set
      const cookieHeader = res.headers.get('set-cookie');
      assert.ok(cookieHeader);
      assert.match(cookieHeader, /oauth_state=/);
      assert.match(cookieHeader, /HttpOnly/i);
    } finally {
      process.env.GOOGLE_CLIENT_ID = origId;
      process.env.GOOGLE_CLIENT_SECRET = origSecret;
      process.env.GOOGLE_CALLBACK_URL = origCb;
    }
  });

  // 4. Callback handles user cancellation
  test('GET /api/auth/google/callback redirects with error when user cancels', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/callback?error=access_denied`, {
      redirect: 'manual'
    });
    assert.equal(res.status, 302);
    const location = res.headers.get('location');
    assert.match(location, /\/\?auth_error=google_access_denied/);
  });

  // 5. Callback rejects missing or invalid state (CSRF Protection)
  test('GET /api/auth/google/callback rejects missing or mismatched state with invalid_state', async () => {
    // Missing cookie
    const resNoCookie = await fetch(`${baseUrl}/api/auth/google/callback?code=fake_code&state=fake_state`, {
      redirect: 'manual'
    });
    assert.equal(resNoCookie.status, 302);
    assert.match(resNoCookie.headers.get('location'), /\/\?auth_error=invalid_state/);

    // Mismatched state in cookie
    const resMismatched = await fetch(`${baseUrl}/api/auth/google/callback?code=fake_code&state=client_state_123`, {
      headers: {
        Cookie: 'oauth_state=different_state_456'
      },
      redirect: 'manual'
    });
    assert.equal(resMismatched.status, 302);
    assert.match(resMismatched.headers.get('location'), /\/\?auth_error=invalid_state/);
  });

  // 6. Callback redirects with unauthorized_account error when Google user is not in database
  test('GET /api/auth/google/callback rejects unauthorized Google accounts with clear error code and email parameter', async () => {
    // Mock global fetch to return Google userinfo for unregistered email
    const originalFetch = global.fetch;
    const testState = 'valid_test_state_123';

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'mock_access_token_xyz' })
        };
      }
      if (typeof url === 'string' && url.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return {
          ok: true,
          json: async () => ({
            email: 'unregistered.person@gmail.com',
            email_verified: true,
            name: 'Unregistered User'
          })
        };
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await originalFetch(`${baseUrl}/api/auth/google/callback?code=mock_code&state=${testState}`, {
        headers: {
          Cookie: `oauth_state=${testState}`
        },
        redirect: 'manual'
      });

      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location);
      assert.match(location, /\/\?auth_error=unauthorized_account/);
      assert.match(location, /email=unregistered\.person%40gmail\.com/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 7. Callback succeeds with token and session cookie for registered Google account
  test('GET /api/auth/google/callback authenticates registered user and redirects with token', async () => {
    const originalFetch = global.fetch;
    const testState = 'valid_auth_state_456';

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'mock_token_admin' })
        };
      }
      if (typeof url === 'string' && url.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return {
          ok: true,
          json: async () => ({
            email: 'admin@edvanta.msot.edu',
            email_verified: true,
            name: 'Prof. Rajesh Sharma'
          })
        };
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await originalFetch(`${baseUrl}/api/auth/google/callback?code=mock_code&state=${testState}`, {
        headers: {
          Cookie: `oauth_state=${testState}`
        },
        redirect: 'manual'
      });

      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location);
      assert.match(location, /\/\?auth_success=1/);
      assert.match(location, /token=/);

      const cookies = res.headers.get('set-cookie');
      assert.ok(cookies);
      assert.match(cookies, /edvanta_token=/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 8. GOOGLE_ALLOWED_EMAIL_1: Authorized Google account #1 is recognized and preserves default STUDENT role (not automatically ADMIN)
  test('GET /api/auth/google/callback authorizes GOOGLE_ALLOWED_EMAIL_1 and preserves role-based access (STUDENT)', async () => {
    const originalFetch = global.fetch;
    const testState = 'valid_auth_state_allow_1';
    const testEmail = 'sainasakshi@gmail.com';

    process.env.GOOGLE_ALLOWED_EMAIL_1 = testEmail;
    delete process.env.GOOGLE_ALLOWED_ROLE_1;

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'mock_token_allow_1' })
        };
      }
      if (typeof url === 'string' && url.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return {
          ok: true,
          json: async () => ({
            email: testEmail,
            email_verified: true,
            name: 'Sakshi Saina'
          })
        };
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await originalFetch(`${baseUrl}/api/auth/google/callback?code=mock_code&state=${testState}`, {
        headers: { Cookie: `oauth_state=${testState}` },
        redirect: 'manual'
      });

      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location);
      assert.match(location, /\/\?auth_success=1/);
      assert.match(location, /token=/);

      // Verify the user is created with role STUDENT, NOT automatically ADMIN
      const createdUser = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [testEmail.toLowerCase()]);
      assert.ok(createdUser, 'User record must exist in SQLite for session integrity');
      assert.equal(createdUser.role, 'STUDENT', 'Allowlisted email must NOT automatically receive ADMIN privileges');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 9. GOOGLE_ALLOWED_EMAIL_2: Authorized Google account #2 is recognized with case-insensitive normalization
  test('GET /api/auth/google/callback authorizes GOOGLE_ALLOWED_EMAIL_2 with case-insensitive normalization', async () => {
    const originalFetch = global.fetch;
    const testState = 'valid_auth_state_allow_2';
    const testEmail = 'sainakumari32@gmail.com';

    // Store in uppercase in env, verify with mixed case in Google claim
    process.env.GOOGLE_ALLOWED_EMAIL_2 = 'SAINAKUMARI32@GMAIL.COM';

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'mock_token_allow_2' })
        };
      }
      if (typeof url === 'string' && url.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return {
          ok: true,
          json: async () => ({
            email: 'SainaKumari32@Gmail.Com',
            email_verified: true,
            name: 'Saina Kumari'
          })
        };
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await originalFetch(`${baseUrl}/api/auth/google/callback?code=mock_code&state=${testState}`, {
        headers: { Cookie: `oauth_state=${testState}` },
        redirect: 'manual'
      });

      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location);
      assert.match(location, /\/\?auth_success=1/);
      assert.match(location, /token=/);

      const createdUser = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [testEmail.toLowerCase()]);
      assert.ok(createdUser);
      assert.equal(createdUser.role, 'STUDENT');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 10. GOOGLE_ALLOWED_EMAIL_3: Authorized Google account #3 is recognized with whitespace normalization
  test('GET /api/auth/google/callback authorizes GOOGLE_ALLOWED_EMAIL_3 with whitespace normalization', async () => {
    const originalFetch = global.fetch;
    const testState = 'valid_auth_state_allow_3';
    const testEmail = 'khushbukhantwal@gmail.com';

    // Env contains padding whitespace
    process.env.GOOGLE_ALLOWED_EMAIL_3 = '   khushbukhantwal@gmail.com   ';

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'mock_token_allow_3' })
        };
      }
      if (typeof url === 'string' && url.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return {
          ok: true,
          json: async () => ({
            email: '  khushbukhantwal@gmail.com  ',
            email_verified: true,
            name: 'Khushbu Khantwal'
          })
        };
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await originalFetch(`${baseUrl}/api/auth/google/callback?code=mock_code&state=${testState}`, {
        headers: { Cookie: `oauth_state=${testState}` },
        redirect: 'manual'
      });

      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location);
      assert.match(location, /\/\?auth_success=1/);
      assert.match(location, /token=/);

      const createdUser = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [testEmail.toLowerCase()]);
      assert.ok(createdUser);
      assert.equal(createdUser.role, 'STUDENT');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 11. Role customization: Non-default role (FACULTY) can be configured via environment variable
  test('GET /api/auth/google/callback respects role override via GOOGLE_ALLOWED_ROLE environment variable', async () => {
    const originalFetch = global.fetch;
    const testState = 'valid_auth_state_fac_override';
    const testEmail = 'test.faculty.google@gmail.com';

    process.env.GOOGLE_ALLOWED_EMAIL_1 = testEmail;
    process.env.GOOGLE_ALLOWED_ROLE_1 = 'FACULTY';

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'mock_token_fac_override' })
        };
      }
      if (typeof url === 'string' && url.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return {
          ok: true,
          json: async () => ({
            email: testEmail,
            email_verified: true,
            name: 'Custom Faculty Evaluator'
          })
        };
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await originalFetch(`${baseUrl}/api/auth/google/callback?code=mock_code&state=${testState}`, {
        headers: { Cookie: `oauth_state=${testState}` },
        redirect: 'manual'
      });

      assert.equal(res.status, 302);
      const location = res.headers.get('location');
      assert.ok(location);
      assert.match(location, /\/\?auth_success=1/);

      const createdUser = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [testEmail.toLowerCase()]);
      assert.ok(createdUser);
      assert.equal(createdUser.role, 'FACULTY', 'Role must match GOOGLE_ALLOWED_ROLE_1');
    } finally {
      delete process.env.GOOGLE_ALLOWED_ROLE_1;
      global.fetch = originalFetch;
    }
  });
});
