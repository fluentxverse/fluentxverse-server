const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const requireStudent = createRequire(resolve('../../fluentxverse-student-solid-prototype/package.json'));
const { chromium } = requireStudent('@playwright/test');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  await fs.mkdir('../../output/screenshots/screening', { recursive: true });
  try {
    for (const app of (process.env.SCREENING_UI_APP ? [process.env.SCREENING_UI_APP] : ['student', 'tutor'])) for (const width of [1440, 375, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 950 } });
      let shared = false, verified = true;
      const credential = () => ({ commitment: '123', status: 'proof_ready', shared, revoked: false, expiresAt: '1823212800', verificationUrl: shared ? 'https://api.fluentxverse.com/screening/public/123' : null });
      const user = { userId: 'screening-ui-tutor', firstName: 'Alex', lastName: 'Teacher', givenName: 'Alex', role: app, email: 'screening@example.test' };
      await context.route(/^(https:\/\/api\.fluentxverse\.(com|xyz)|http:\/\/(localhost|127\.0\.0\.1):(?:8765|8780|8782))\//, async route => {
        const path = new URL(route.request().url()).pathname;
        let json = { success: true, user, data: [], profile: {}, lessons: [] };
        if (path === '/tutor/profile' || path === '/tutor/screening-ui-tutor') json.data = { ...user, bio: 'Practical English for everyday conversations.', languages: ['English'], interests: ['Travel'], education: ['Language education'], profileStatus: 'approved', rating: 4.9, totalReviews: 12, country: 'Philippines' };
        if (path === '/screening/me') json.data = { enabled: true, credentials: [credential()] };
        if (path === '/screening/123/share') { shared = route.request().postDataJSON().shared; json.data = credential(); }
        if (path === '/screening/tutor/screening-ui-tutor') json.data = { commitment: '123', certified: verified, status: verified ? 'verified' : 'pending', expiresAt: '1823212800' };
        if (path.includes('/personal-info')) json.data = user;
        if (path === '/schedule/week') json.data = { slots: [], weekStart: '2026-10-05', weekEnd: '2026-10-11' };
        if (path.includes('/unread-count')) json.data = { unreadCount: 0 };
        if (path.startsWith('/notifications')) json.data = { notifications: [], unreadCount: 0 };
        return route.fulfill({ json });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const base = app === 'student' ? 'http://127.0.0.1:5176' : 'http://127.0.0.1:5177';
      const path = app === 'student' ? '/tutor/screening-ui-tutor' : '/profile';
      await page.goto(base + path, { waitUntil: 'networkidle' });
      if (app === 'student') {
        await page.locator('.screening-certification summary').click();
        await page.getByText(/This verifies the issuer's results/).waitFor();
      } else {
        try { await page.getByRole('heading', { name: 'Screening Credential', exact: true }).waitFor(); }
        catch (error) {
          console.error({ url: page.url(), errors, body: (await page.locator('body').innerText()).slice(0, 1000) });
          await page.screenshot({ path: '../../output/screenshots/screening/tutor-failure.png' });
          throw error;
        }
        await page.getByLabel('Share certification').check();
        await page.locator('.screening-credential a').waitFor();
        assert.equal(shared, true);
        await page.getByLabel('Share certification').uncheck();
        assert.equal(shared, false);
      }
      const selector = app === 'student' ? '.screening-certification' : '.screening-credential';
      await page.locator(selector).scrollIntoViewIfNeeded();
      assert(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Credential content fits its container');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${app} ${width}: viewport overflow`);
      await page.screenshot({ path: `../../output/screenshots/screening/${app}-${width}.png` });
      assert.deepEqual(errors, []);
      if (app === 'student') {
        verified = false; await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('.screening-certification').count(), 0, 'Pending credentials must not receive a verified badge');
      }
      console.log(`PASS ${app} ${width}: credential disclosure, sharing controls or verified-only badge, no overflow or runtime errors`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
