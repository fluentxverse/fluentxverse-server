import { expect, test } from 'bun:test';
import { safeEmailCss, safeReceivedHtml } from '../src/services/mail/mailHtml';

test('received email retains table layout, typography, backgrounds and responsive CSS without injected borders', () => {
  const html = safeReceivedHtml('<style>@media screen and (max-width:600px){.body{width:100%!important}}.brand{background-color:#123456;padding:24px;font-family:Arial,sans-serif}</style><table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center"><tr><td class="brand" style="border:0;line-height:24px;color:#fff">Welcome</td></tr></table>');
  expect(html).toContain('width="600"'); expect(html).toContain('cellpadding="0"'); expect(html).toContain('align="center"');
  expect(html).toContain('@media screen'); expect(html).toContain('background-color:#123456'); expect(html).toContain('border:0');
});

test('received stylesheet and inline style parsing remove network loads, executable CSS and unsupported rules', () => {
  const css = safeEmailCss('@import "https://tracker.test/css";@font-face{src:url(https://tracker.test/font)}.a{background:url(https://tracker.test/bg);color:red;position:fixed;behavior:expression(alert(1));--x:url(https://tracker.test);font-size:16px}', true);
  expect(css).toContain('color:red'); expect(css).toContain('font-size:16px'); expect(css).not.toMatch(/tracker|import|font-face|position|expression|--x/);
  const html = safeReceivedHtml('<style>@import "https://tracker.test/css";.a{background:url(https://tracker.test/bg);color:red}</style><script>evil()</script><svg onload="evil()"/><iframe src="https://tracker.test"/><form><input></form>');
  expect(html).toContain('color:red'); expect(html).not.toMatch(/url\s*\(|@import|<script|<svg|onload|<iframe|<form|<input/);
  const fallback = safeReceivedHtml('<iframe><style>@import "https://tracker.test/css";.x{background:url(https://tracker.test/bg)}</style><img src="https://tracker.test/pixel"></iframe>');
  expect(fallback).not.toMatch(/tracker|style|img|import/);
});

test('background artwork is preserved as inert references across inline, legacy and responsive styles', () => {
  const html = safeReceivedHtml(`<style>@media (max-width:480px){.hero{background-image:url('https://images.example.com/mobile.png');background-size:cover}}</style><table><tr><td class="hero" background="https://images.example.com/hero.png" style="background:url('https://images.example.com/hero.png') center no-repeat;background-size:cover;font-family:'proxima_nova',Arial">Welcome</td></tr></table>`);
  expect(html).toContain('data-mail-backgrounds'); expect(html).toContain('var(--mail-bg-');
  expect(html).toContain('background-size:cover'); expect(html).toContain('proxima_nova');
  expect(html).toContain('https://images.example.com/mobile.png'); expect(html).toContain('https://images.example.com/hero.png');
  expect(html).not.toMatch(/url\s*\(|background="/);
});

test('background references cannot bypass image policy, inject variables or forge a registry', () => {
  const html = safeReceivedHtml(`<template data-mail-backgrounds>{"--mail-bg-1":"https://attacker.example.com"}</template><style>.a{background:url(javascript:evil());--mail-bg-0:url(https://attacker.example.com);color:var(--mail-bg-0)}.b{background:url('https://127.0.0.1/private')}.c{background:url('http://tracker.test/pixel')}.d{background:image-set('https://tracker.test/pixel' 1x)}.e{background:u\\72l(https://tracker.test/pixel)}</style>`);
  expect(html).not.toMatch(/attacker|127\.0\.0\.1|tracker|javascript|data-mail-backgrounds|var\(/);
});

test('background metadata has a fixed resource budget', () => {
  const html = safeReceivedHtml(`<style>${Array.from({ length: 60 }, (_, i) => `.bg${i}{background-image:url(https://images.example.com/${i}.png)}`).join('')}</style>`);
  const metadata = html.match(/<template data-mail-backgrounds>(.*?)<\/template>/)?.[1];
  expect(Object.keys(JSON.parse(metadata!))).toHaveLength(40);
  expect(html).not.toContain('--mail-bg-40');
});

test('remote images stay inert until the reader explicitly enables them; unsafe image URLs are removed', () => {
  const html = safeReceivedHtml('<img src="https://images.example.com/logo.png" width="120" alt="Logo" onerror="evil()"><img src="javascript:evil()"><img src="http://tracker.test/x"><img src="https://127.0.0.1/x"><img src="https://secret@tracker.test/x">');
  expect(html).toContain('data-mail-src="https://images.example.com/logo.png"'); expect(html).toContain('width="120"');
  expect(html).not.toMatch(/<img src=|javascript|onerror|127\.0\.0\.1|secret@|http:\/\//);
});

test('CID raster images render inline only with a matching type, file signature and size budget', () => {
  const content = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6d6kAAAAASUVORK5CYII=', 'base64');
  const html = safeReceivedHtml('<img src="cid:logo"><img src="cid:bad"><img src="cid:svg">', [
    { contentId: '<logo>', contentType: 'image/png', content },
    { contentId: 'bad', contentType: 'image/png', content: Buffer.from('<svg/>') },
    { contentId: 'svg', contentType: 'image/svg+xml', content: Buffer.from('<svg/>') },
  ]);
  expect(html).toContain('src="data:image/png;base64,'); expect(html.match(/src=/g)).toHaveLength(1);
  expect(html).not.toContain('image/svg');
});
