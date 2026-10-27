const { chromium, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const output = path.resolve('../output/email/tutor-confirmation');
  await fs.mkdir(output, { recursive: true });
  // Exercise the same MIME decoding and received-email sanitizer as the admin reader.
  const preview = path.join(output, 'synthetic-preview.json');
  execFileSync('bun', ['--no-env-file', 'test', 'tests/tutorEmailTemplate.test.ts'], {
    env: { ...process.env, EMAIL_TEMPLATE_PREVIEW_FILE: preview }, stdio: ['ignore', 'ignore', 'inherit'] });
  const data = JSON.parse(await fs.readFile(preview, 'utf8'));
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  try {
    for (const width of [800, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const remoteRequests = [];
      await context.route('**/*', route => { remoteRequests.push(route.request().url()); return route.abort(); });
      const page = await context.newPage();
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">' + data.html + '</body></html>');
      await expect(page.getByRole('heading', { name: 'Confirm your email', exact: true })).toBeVisible();
      const cta = page.getByRole('link', { name: 'Confirm email address', exact: true });
      await expect(cta).toHaveAttribute('href', data.url);
      await expect(page.getByRole('link', { name: data.url, exact: true })).toHaveAttribute('href', data.url);
      await expect.poll(() => page.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      const dimensions = await cta.boundingBox(); assert(dimensions.height >= 44);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(remoteRequests, []);
      await page.screenshot({ path: path.join(output, `${width}.png`), fullPage: true });
      await context.close();
      console.log(`PASS confirmation email ${width}: branded logo, clickable button and fallback, no overflow or remote images`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
