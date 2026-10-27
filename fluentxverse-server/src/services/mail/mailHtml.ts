import sanitizeHtml from 'sanitize-html';
import postcss from 'postcss';
import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import valueParser from 'postcss-value-parser';

const properties = new Set(('color background background-color background-image background-position background-repeat background-size font font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration text-transform white-space word-break overflow-wrap width min-width max-width height min-height max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-width border-style border-color border-radius border-collapse border-spacing box-sizing display vertical-align table-layout list-style list-style-type opacity overflow').split(' '));

function remoteImage(source: string) {
  try {
    const url = new URL(source.startsWith('//') ? `https:${source}` : source);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.') && !url.hostname.startsWith('[') && !/^\d+(\.\d+){3}$/.test(url.hostname) && !/\.(localhost|local|internal|lan)$/i.test(url.hostname) ? url.href : '';
  } catch { return ''; }
}
function backgroundReference(source: string, backgrounds?: Map<string, string>) {
  const url = remoteImage(source);
  if (!url || !backgrounds) return '';
  let name = backgrounds.get(url);
  if (!name) {
    if (backgrounds.size >= 40) return '';
    name = `--mail-bg-${backgrounds.size}`; backgrounds.set(url, name);
  }
  return name;
}

export function safeEmailCss(input: string, stylesheet = false, backgrounds?: Map<string, string>) {
  if (input.length > 100_000) return '';
  try {
    const root = postcss.parse(stylesheet ? input : `email{${input}}`);
    root.walkComments(comment => { comment.remove(); });
    root.walkAtRules(rule => { if (!stylesheet || rule.name.toLowerCase() !== 'media' || !/^[a-z0-9\s():.,/-]{1,300}$/i.test(rule.params)) rule.remove(); });
    root.walkRules(rule => { if (!/^[a-z0-9\s.#:[\]()=~|*^$>+,'"-]{1,1000}$/i.test(rule.selector)) rule.remove(); });
    let count = 0;
    root.walkDecls(declaration => {
      const property = declaration.prop.toLowerCase();
      if (++count > 2000 || !properties.has(property) || declaration.value.length > 500 || /[\\<>@{};]|\/\*|\*\/|expression|image-set|image\s*\(|var\s*\(|attr\s*\(/i.test(declaration.value)) { declaration.remove(); return; }
      const parsed = valueParser(declaration.value); let invalid = false;
      parsed.walk(node => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
        const argument = node.nodes[0];
        const name = ['background', 'background-image'].includes(property) && !node.unclosed && node.nodes.length === 1 && argument && ['string', 'word'].includes(argument.type) && !('unclosed' in argument && argument.unclosed) ? backgroundReference(argument.value, backgrounds) : '';
        if (!name) { invalid = true; return false; }
        node.value = 'var'; node.nodes = valueParser(`${name},none`).nodes;
        return false;
      });
      const value = parsed.toString();
      if (invalid || !/^[a-z0-9_\s#%.,()/'"!+*-]+$/i.test(value)) declaration.remove();
      else declaration.value = value;
    });
    return stylesheet ? root.toString() : root.first?.type === 'rule' ? root.first.nodes.map(node => node.toString()).join(';') : '';
  } catch { return ''; }
}

export interface InlineMailImage { contentId?: string; contentType: string; content: Buffer }
function rasterImage(file: InlineMailImage) {
  const bytes = file.content, type = file.contentType.toLowerCase();
  return type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ||
    type === 'image/gif' && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) ||
    type === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}
export function safeReceivedHtml(html: string, files: InlineMailImage[] = []) {
  const backgrounds = new Map<string, string>();
  const document = parseDocument(html), pending = [...document.children];
  const blocked = new Set(['script', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select', 'link', 'base', 'meta', 'template']);
  let nodes = 0;
  while (pending.length) {
    const node = pending.pop()!;
    if (++nodes > 50_000) return '';
    // Remove fallback containers before sanitization can re-parse their raw HTML as live content.
    if ('name' in node && blocked.has(node.name)) {
      if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
      continue;
    }
    if ('children' in node) {
      if ('name' in node && node.name === 'style') {
        for (const child of node.children) if (child.type === 'text') child.data = safeEmailCss(child.data, true, backgrounds);
      } else pending.push(...node.children);
    }
  }
  const images = new Map(files.filter(file => file.contentId && file.content.length <= 2 * 1024 * 1024 && rasterImage(file))
    .map(file => [file.contentId!.replace(/^<|>$/g, ''), file]));
  let imageBudget = 2 * 1024 * 1024;
  const sanitized = sanitizeHtml(render(document), {
    allowedTags: ['style', 'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'ol', 'ul', 'li', 'blockquote', 'a', 'h1', 'h2', 'h3', 'h4', 'hr', 'pre', 'code', 'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'img', 'center', 'font'],
    allowVulnerableTags: true,
    allowedAttributes: { '*': ['style', 'class', 'id', 'align', 'valign', 'width', 'height', 'bgcolor', 'role'],
      a: ['href', 'target', 'rel', 'style', 'class'], img: ['src', 'data-mail-src', 'alt', 'title', 'width', 'height', 'style', 'class'],
      table: ['style', 'class', 'id', 'align', 'width', 'height', 'bgcolor', 'role', 'border', 'cellpadding', 'cellspacing'],
      td: ['style', 'class', 'align', 'valign', 'width', 'height', 'bgcolor', 'colspan', 'rowspan'], th: ['style', 'class', 'align', 'valign', 'width', 'height', 'bgcolor', 'colspan', 'rowspan'], font: ['color', 'face', 'size'] },
    allowedSchemes: ['https', 'http', 'mailto'], allowedSchemesByTag: { img: ['data'] }, allowProtocolRelative: false,
    transformTags: { '*': (tagName, attributes) => {
      const attribs = { ...attributes };
      if (tagName === 'body') tagName = 'div';
      if (attribs.style) attribs.style = safeEmailCss(attribs.style, false, backgrounds);
      if (['body', 'div', 'table', 'td', 'th'].includes(tagName) && attribs.background) {
        const name = backgroundReference(attribs.background, backgrounds);
        if (name) attribs.style = `background-image:var(${name},none);${attribs.style || ''}`;
      }
      delete attribs.background;
      if (tagName === 'a') { attribs.target = '_blank'; attribs.rel = 'noopener noreferrer'; }
      if (tagName === 'img') {
        const source = attribs.src || ''; delete attribs.src; delete attribs['data-mail-src'];
        let embedded: InlineMailImage | undefined;
        try { if (/^cid:/i.test(source)) embedded = images.get(decodeURIComponent(source.slice(4)).replace(/^<|>$/g, '')); } catch {}
        if (embedded && embedded.content.length <= imageBudget) {
          imageBudget -= embedded.content.length;
          attribs.src = `data:${embedded.contentType.toLowerCase()};base64,${embedded.content.toString('base64')}`;
        } else {
          const url = remoteImage(source);
          if (url) attribs['data-mail-src'] = url;
        }
      }
      return { tagName, attribs };
    } },
  });
  // URL metadata is inert; only the reader's explicit image consent resolves these variables.
  const metadata = JSON.stringify(Object.fromEntries([...backgrounds].map(([url, name]) => [name, url]))).replace(/[<>&]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[character]!));
  return backgrounds.size ? `${sanitized}<template data-mail-backgrounds>${metadata}</template>` : sanitized;
}
