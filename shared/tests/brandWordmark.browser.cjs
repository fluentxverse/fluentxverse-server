const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const bases = { student: process.env.STUDENT_TEST_URL || 'http://127.0.0.1:5203', tutor: process.env.TUTOR_TEST_URL || 'http://127.0.0.1:5204' };
const widths = (process.env.BRAND_TEST_WIDTHS || '1566,375,320').split(',').map(Number);

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  await fs.mkdir('output/screenshots/brand-wordmark', { recursive: true });
  try {
    for (const app of (process.env.BRAND_TEST_APPS || 'student,tutor').split(',')) for (const authenticated of (process.env.BRAND_TEST_AUTH === 'true' ? [true] : [false, true])) for (const theme of ['light', 'dark']) for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 950 } });
      await context.addInitScript(theme => localStorage.setItem('theme-storage', JSON.stringify({ state: { themeMode: theme, isDarkMode: theme === 'dark' }, version: 2 })), theme);
      await context.route(/^(https:\/\/api\.fluentxverse\.(?:com|xyz)|http:\/\/(localhost|127\.0\.0\.1):(?:8765|8780|8782))\//, route => {
        const path = new URL(route.request().url()).pathname;
        const user = { userId: 'brand-fixture', firstName: 'Alex', lastName: 'Learner', role: app, email: 'brand@example.com' };
        if (path === `/${app}/me`) return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { success: true, user } : { success: false } });
        if (path === '/lesson-passes/mode') return route.fulfill({ json: { success: true, data: { mode: 'legacy_erc1155' } } });
        if (path === '/tutor/search') return route.fulfill({ json: { success: true, data: { tutors: [], total: 0, hasMore: false } } });
        if (path === '/notifications') return route.fulfill({ json: { success: true, data: { notifications: [], unreadCount: 0 } } });
        return route.fulfill({ json: { success: true, user, data: [], status: { passed: true }, lessons: [] } });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const check = async label => {
        const words = page.locator('.fxv-wordmark:visible');
        for (const word of await words.all()) {
          const result = await word.evaluate(element => {
            const text = element.querySelector('.fxv-wordmark__text'), x = element.querySelector('.fxv-wordmark__x');
            const style = getComputedStyle(text), accent = getComputedStyle(x), box = text.getBoundingClientRect();
            const dark = document.documentElement.dataset.theme === 'dark' || Boolean(element.closest('.dark-mode'));
            return { text: text.textContent, font: style.fontFamily, weight: style.fontWeight, spacing: style.letterSpacing, color: style.color, fill: style.webkitTextFillColor, x: accent.color, xFill: accent.webkitTextFillColor, inverse: element.classList.contains('fxv-wordmark--inverse'), dark, left: box.left, right: box.right, width: innerWidth };
          });
          assert.equal(result.text, 'FluentXVerse', label);
          assert(result.font.includes('Poppins'), `${label}: canonical font`);
          assert.equal(result.weight, '800', `${label}: canonical weight`);
          assert(['0px', 'normal'].includes(result.spacing), `${label}: no added letter spacing`);
          assert.equal(result.x, 'rgb(79, 180, 255)', `${label}: homepage blue X`);
          assert.equal(result.xFill, result.x, `${label}: no legacy gradient text fill`);
          assert.equal(result.color, result.inverse || result.dark ? 'rgb(247, 251, 255)' : 'rgb(2, 69, 174)', `${label}: readable wordmark tone`);
          assert.equal(result.fill, result.color, `${label}: text fill follows theme`);
          assert(result.left >= -1 && result.right <= result.width + 1, `${label}: wordmark stays within viewport: ${JSON.stringify(result)}`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: no horizontal overflow`);
      };
      const route = authenticated ? (app === 'student' ? '/browse-tutors' : '/knowledge-base') : '/';
      try {
        await page.goto(bases[app] + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (error) {
        if (error.name !== 'TimeoutError') throw error;
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
      }
      if (authenticated && app === 'tutor') await expect(page.getByRole('heading', { name: 'Knowledge Base', exact: true })).toBeVisible();
      else await expect(page.locator('header .fxv-wordmark').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await check(`${app}/${authenticated}/${theme}/${width}`);
      if (!authenticated && app === 'student') {
        await page.goto(bases[app] + '/browse-tutors');
        await expect(page.locator('header .fxv-wordmark').first()).toBeVisible();
        await check('student browse');
      }
      if (width < 768) {
        await page.getByRole('button', { name: authenticated && app === 'tutor' ? 'Open menu' : 'Open mobile menu', exact: true }).click();
        await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getTiming().iterations)).map(animation => animation.finished.catch(() => {}))));
        if (app === 'student') await expect(page.locator('.mobile-menu .fxv-wordmark')).toHaveClass(/fxv-wordmark--inverse/);
        await check('mobile menu');
        if (!authenticated) await page.locator('.mobile-login-btn').click();
        else await page.keyboard.press('Escape');
      } else if (!authenticated) await page.locator('.header-login button').click();
      if (!authenticated) {
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('dialog').locator('.fxv-wordmark')).toBeVisible();
        await check('sign in');
      }
      await page.screenshot({ path: `output/screenshots/brand-wordmark/${app}-${authenticated ? 'app' : 'public'}-${theme}-${width}.png` });
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS wordmark ${app} ${authenticated ? 'app' : 'public'} ${theme} ${width}`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
