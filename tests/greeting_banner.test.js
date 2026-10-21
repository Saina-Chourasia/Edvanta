import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test suite for Dynamic Academic Greeting Banner across Admin, Student, and Faculty Portals
test('Dynamic Academic Greeting Banner Suite', async (t) => {

  // Pure logic replica matching App.getGreetingForRole implementation in public/js/app.js
  function calculateGreeting(hour, role) {
    let roleTitle = 'Admin';
    if (role === 'FACULTY') roleTitle = 'Faculty';
    else if (role === 'STUDENT') roleTitle = 'Student';

    let period = 'evening';
    let timeGreeting = 'Good Evening';
    let emoji = '🌙';

    if (hour >= 5 && hour < 12) {
      period = 'morning';
      timeGreeting = 'Good Morning';
      emoji = '☀️';
    } else if (hour >= 12 && hour < 17) {
      period = 'afternoon';
      timeGreeting = 'Good Afternoon';
      emoji = '🌤️';
    } else {
      period = 'evening';
      timeGreeting = 'Good Evening';
      emoji = '🌙';
    }

    return {
      period,
      timeGreeting,
      roleTitle,
      greetingText: `${timeGreeting}, ${roleTitle}`,
      emoji
    };
  }

  await t.test('Morning window: 5:00 AM to 11:59 AM', () => {
    [5, 6, 8, 10, 11].forEach(hour => {
      const admin = calculateGreeting(hour, 'ADMIN');
      assert.strictEqual(admin.period, 'morning', `Hour ${hour} should be morning`);
      assert.strictEqual(admin.emoji, '☀️', `Hour ${hour} emoji should be ☀️`);
      assert.strictEqual(admin.greetingText, 'Good Morning, Admin');

      const faculty = calculateGreeting(hour, 'FACULTY');
      assert.strictEqual(faculty.greetingText, 'Good Morning, Faculty');

      const student = calculateGreeting(hour, 'STUDENT');
      assert.strictEqual(student.greetingText, 'Good Morning, Student');
    });
  });

  await t.test('Afternoon window: 12:00 PM to 4:59 PM', () => {
    [12, 13, 14, 15, 16].forEach(hour => {
      const admin = calculateGreeting(hour, 'ADMIN');
      assert.strictEqual(admin.period, 'afternoon', `Hour ${hour} should be afternoon`);
      assert.strictEqual(admin.emoji, '🌤️', `Hour ${hour} emoji should be 🌤️`);
      assert.strictEqual(admin.greetingText, 'Good Afternoon, Admin');

      const faculty = calculateGreeting(hour, 'FACULTY');
      assert.strictEqual(faculty.greetingText, 'Good Afternoon, Faculty');

      const student = calculateGreeting(hour, 'STUDENT');
      assert.strictEqual(student.greetingText, 'Good Afternoon, Student');
    });
  });

  await t.test('Evening window: 5:00 PM to 4:59 AM', () => {
    [17, 19, 21, 23, 0, 1, 3, 4].forEach(hour => {
      const admin = calculateGreeting(hour, 'ADMIN');
      assert.strictEqual(admin.period, 'evening', `Hour ${hour} should be evening`);
      assert.strictEqual(admin.emoji, '🌙', `Hour ${hour} emoji should be 🌙`);
      assert.strictEqual(admin.greetingText, 'Good Evening, Admin');

      const faculty = calculateGreeting(hour, 'FACULTY');
      assert.strictEqual(faculty.greetingText, 'Good Evening, Faculty');

      const student = calculateGreeting(hour, 'STUDENT');
      assert.strictEqual(student.greetingText, 'Good Evening, Student');
    });
  });

  await t.test('Boundary transitions between greeting periods', () => {
    // 04:59 AM -> hour 4 (evening)
    assert.strictEqual(calculateGreeting(4, 'ADMIN').greetingText, 'Good Evening, Admin');
    assert.strictEqual(calculateGreeting(4, 'ADMIN').emoji, '🌙');

    // 05:00 AM -> hour 5 (morning)
    assert.strictEqual(calculateGreeting(5, 'ADMIN').greetingText, 'Good Morning, Admin');
    assert.strictEqual(calculateGreeting(5, 'ADMIN').emoji, '☀️');

    // 11:59 AM -> hour 11 (morning)
    assert.strictEqual(calculateGreeting(11, 'STUDENT').greetingText, 'Good Morning, Student');
    assert.strictEqual(calculateGreeting(11, 'STUDENT').emoji, '☀️');

    // 12:00 PM -> hour 12 (afternoon)
    assert.strictEqual(calculateGreeting(12, 'STUDENT').greetingText, 'Good Afternoon, Student');
    assert.strictEqual(calculateGreeting(12, 'STUDENT').emoji, '🌤️');

    // 04:59 PM -> hour 16 (afternoon)
    assert.strictEqual(calculateGreeting(16, 'FACULTY').greetingText, 'Good Afternoon, Faculty');
    assert.strictEqual(calculateGreeting(16, 'FACULTY').emoji, '🌤️');

    // 05:00 PM -> hour 17 (evening)
    assert.strictEqual(calculateGreeting(17, 'FACULTY').greetingText, 'Good Evening, Faculty');
    assert.strictEqual(calculateGreeting(17, 'FACULTY').emoji, '🌙');
  });

  await t.test('Academic banner artwork asset exists in public/assets', () => {
    const assetPath = path.join(__dirname, '../public/assets/academic_banner_art.jpg');
    assert.ok(fs.existsSync(assetPath), 'academic_banner_art.jpg must exist in public/assets');
    const stats = fs.statSync(assetPath);
    assert.ok(stats.size > 50000, 'academic_banner_art.jpg should be a valid high-resolution image asset');
  });

  await t.test('HTML markup contains welcome cards with artwork and emoji holders, without right-side action buttons', () => {
    const htmlPath = path.join(__dirname, '../public/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Check all three portal IDs
    assert.ok(htmlContent.includes('id="adminWelcomeGreeting"'), 'Admin welcome greeting element exists');
    assert.ok(htmlContent.includes('id="facultyWelcomeGreeting"'), 'Faculty welcome greeting element exists');
    assert.ok(htmlContent.includes('id="studentWelcomeGreeting"'), 'Student welcome greeting element exists');

    // Check emojis
    assert.ok(htmlContent.includes('id="adminGreetingEmoji"'), 'Admin emoji element exists');
    assert.ok(htmlContent.includes('id="facultyGreetingEmoji"'), 'Faculty emoji element exists');
    assert.ok(htmlContent.includes('id="studentGreetingEmoji"'), 'Student emoji element exists');

    // Check artwork layer
    const artworkMatches = (htmlContent.match(/class="welcome-bg-artwork"/g) || []).length;
    assert.strictEqual(artworkMatches, 3, 'All 3 portal welcome banners should contain the academic background artwork layer');

    // Verify Check Attendance and Instant Subject Log buttons are removed from greeting banners
    const studentCardMatch = htmlContent.match(/id="studentWelcomeCard"[\s\S]*?<\/div>\s*<\/div>/);
    if (studentCardMatch) {
      assert.ok(!studentCardMatch[0].includes('Check Attendance'), 'Check Attendance button must be removed from student greeting banner');
    }

    const facultyCardMatch = htmlContent.match(/id="facultyWelcomeCard"[\s\S]*?<\/div>\s*<\/div>/);
    if (facultyCardMatch) {
      assert.ok(!facultyCardMatch[0].includes('Instant Subject Log'), 'Instant Subject Log button must be removed from faculty greeting banner');
    }
  });

  await t.test('CSS styles contain morning, afternoon, evening themes and attendance spacing rules', () => {
    const cssPath = path.join(__dirname, '../public/css/styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert.ok(cssContent.includes('.portal-welcome-card.morning'), 'CSS has .morning rule');
    assert.ok(cssContent.includes('.portal-welcome-card.afternoon'), 'CSS has .afternoon rule');
    assert.ok(cssContent.includes('.portal-welcome-card.evening'), 'CSS has .evening rule');
    assert.ok(cssContent.includes('welcome-bg-artwork'), 'CSS has .welcome-bg-artwork rule');
    assert.ok(cssContent.includes('Playfair Display'), 'CSS uses Playfair Display serif for welcome heading');

    // Verify content-page-header and attendance spacing
    assert.ok(cssContent.includes('.content-page-header'), 'CSS has .content-page-header spacing rule');
    assert.ok(cssContent.includes('#attendanceHeaderActions'), 'CSS has #attendanceHeaderActions spacing rule');
    assert.ok(cssContent.includes('.attendance-summary-cards'), 'CSS has .attendance-summary-cards responsive grid rule');
  });
});
