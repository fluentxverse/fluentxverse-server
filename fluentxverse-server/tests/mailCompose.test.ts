import { expect, test } from 'bun:test';
import { simpleParser } from 'mailparser';
import { safeMailHtml, validateDraft } from '../src/services/mail/mailPolicy';
import { buildOutgoingMessage } from '../src/services/mail/mailProvider';
import { MAX_INLINE_IMAGE_BYTES } from '../src/services/mail/mailCompose';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6d6kAAAAASUVORK5CYII=', 'base64');
const image = `data:image/png;base64,${png.toString('base64')}`;
const draft = () => ({id:crypto.randomUUID(),accountId:'support',to:'reader@example.test',cc:'',bcc:'private@example.test',subject:'Composer fixture',text:'Hello [Image: sample.png]',html:'',attachments:[],inReplyTo:'',references:[],revision:0});

test('authored typography survives sanitizing, draft saving and repeated sanitizing', () => {
  const html = '<p style="text-align:center;padding-left:6em"><span style="font-family:Georgia;font-size:18px;color:#ac3045;background-color:#fff099"><strong><u><s>Formatted</s></u></strong></span></p><ol><li>First</li><li>Second</li></ol><blockquote>Quote</blockquote>';
  const saved = validateDraft({...draft(),html});
  for(const value of ['text-align:center','padding-left:6em','font-family:Georgia','font-size:18px','color:#ac3045','background-color:#fff099','<ol>','<blockquote>','<s>']) expect(saved.html).toContain(value);
  expect(safeMailHtml(saved.html)).toBe(saved.html);
});
test('remote images, SVG, script URLs, CSS URLs, classes and active content stay blocked', () => {
  const html = safeMailHtml('<p onclick="steal()" class="bad" style="position:fixed;background-image:url(https://tracker.test/pixel);color:#123456">Safe</p><img src="https://tracker.test/pixel"><img src="data:image/svg+xml;base64,PHN2Zy8+"><img src="data:image/png;base64,YmFk"><script>steal()</script><a href="javascript:steal()">Bad</a><iframe src="https://tracker.test"/><style>body{display:none}</style>');
  expect(html).toContain('color:#123456');
  expect(html).not.toMatch(/onclick|class=|position|url\(|tracker|<img|script|<style|<iframe/);
});
test('inline raster images are bounded and retain safe dimensions and labels', () => {
  const html = safeMailHtml(`<p><img src="${image}" alt="sample" width="200" onerror="steal()"></p>`);
  expect(html).toContain(image); expect(html).toContain('alt="sample"'); expect(html).toContain('width="200"'); expect(html).not.toContain('onerror');
  const large = Buffer.alloc(MAX_INLINE_IMAGE_BYTES + 1); png.copy(large);
  expect(()=>safeMailHtml(`<img src="data:image/png;base64,${large.toString('base64')}">`)).toThrow('192 KB');
  const repeated = `<img src="${image}">`.repeat(Math.floor(MAX_INLINE_IMAGE_BYTES / png.length) + 1);
  expect(()=>safeMailHtml(repeated)).toThrow('192 KB');
});
test('real outgoing MIME uses CID parts for inline images, preserves styles and never leaks Bcc', async () => {
  const account:any = {address:'support@example.test',label:'Support'};
  const value = {...draft(),updatedAt:'',html:`<p style="text-align:right"><span style="font-size:18px;color:#123456">Hello</span><img src="${image}" alt="sample"></p>`};
  const {raw,envelope} = await buildOutgoingMessage(account,value,crypto.randomUUID());
  const parsed = await simpleParser(raw,{skipImageLinks:true});
  expect(parsed.html).toContain('cid:fxv-'); expect(parsed.html).not.toContain('data:image');
  expect(parsed.html).toContain('font-size:18px'); expect(parsed.html).toContain('text-align:right');
  expect(parsed.attachments).toHaveLength(1); expect(parsed.attachments[0].content.equals(png)).toBe(true);
  expect(parsed.attachments[0].contentDisposition).toBe('inline'); expect(parsed.attachments[0].contentId).toContain('fxv-');
  expect(envelope.to).toContain('private@example.test'); expect(raw.toString()).not.toContain('private@example.test');
});
