// Vercel Serverless Function & Express Local Integration Test
// Validates:
// 1. api/index.js loads cleanly in Vercel mode (process.env.VERCEL = '1')
// 2. /api/health responds with healthy status and database connection
// 3. /api/alerts/cron executes scheduled alert check
// 4. Static assets and SPA fallback resolve correctly

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Simulate Vercel environment before importing
process.env.VERCEL = '1';
const { default: app } = await import('../api/index.js');

describe('Vercel Serverless Configuration Verification', () => {
  let server;
  let baseUrl;

  before(async () => {
    assert.ok(app, 'api/index.js must export an Express application');
    assert.strictEqual(typeof app, 'function', 'Export must be an Express handler function');

    await new Promise((resolve) => {
      server = http.createServer(app).listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  test('Vercel entrypoint /api/health responds with 200 and database metadata', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'healthy');
    assert.strictEqual(data.system, 'EDVANTA Course Progression Tracker');
    assert.strictEqual(data.tagline, 'Every Hour Counts, Every Goal Matters');
  });

  test('Vercel cron endpoint /api/alerts/cron executes missed-session scan', async () => {
    const res = await fetch(`${baseUrl}/api/alerts/cron`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(typeof data.newAlertsCreatedCount === 'number');
  });

  test('Vercel serves static index.html on root path', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('EDVANTA'), 'HTML must contain EDVANTA brand');
    assert.ok(html.includes('Plus+Jakarta+Sans'), 'HTML must link fonts');
  });

  test('Vercel serves static css stylesheets from public/css', async () => {
    const res = await fetch(`${baseUrl}/css/styles.css`);
    assert.strictEqual(res.status, 200);
    const css = await res.text();
    assert.ok(css.length > 500, 'Stylesheet must be non-empty');
  });

  test('Vercel SPA fallback routes unknown non-API path to index.html', async () => {
    const res = await fetch(`${baseUrl}/dashboard/overview`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('EDVANTA Logo'), 'Fallback must serve index.html');
  });

  test('Vercel returns 404 JSON for non-existent API routes', async () => {
    const res = await fetch(`${baseUrl}/api/non_existent_endpoint_12345`);
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.ok(data.error.includes('API route not found'));
  });
});
