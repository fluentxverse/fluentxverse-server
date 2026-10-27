import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import sanitizeHtml from 'sanitize-html';

export const MAX_INLINE_IMAGE_BYTES = 192 * 1024;
const imagePattern = /^data:image\/(png|jpeg|gif|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/;

function inlineImage(source: string) {
  if (source.length > 400_000) return null;
  const match = imagePattern.exec(source);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64'), type = match[1];
  const valid = type === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || type === 'jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    || type === 'gif' && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
    || type === 'webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return valid ? { content: bytes, contentType: `image/${type}`, extension: type } : null;
}

// Only typography and locally selected raster images are allowed in authored messages.
export function sanitizeComposedHtml(html: string) {
  let imageBytes = 0;
  const sanitized = sanitizeHtml(html, {
    allowedTags: ['p', 'div', 'span', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ol', 'ul', 'li', 'blockquote', 'a', 'img'],
    allowedAttributes: { '*': ['style'], a: ['href'], img: ['src', 'alt', 'width', 'height', 'style'] },
    allowedSchemes: ['https', 'http', 'mailto'], allowedSchemesByTag: { img: ['data'] }, allowProtocolRelative: false,
    allowedStyles: { '*': {
      color: [/^#[\da-f]{3,8}$/i, /^rgba?\([\d., %]+\)$/i, /^(?:black|white|red|green|blue|transparent)$/i],
      'background-color': [/^#[\da-f]{3,8}$/i, /^rgba?\([\d., %]+\)$/i, /^(?:black|white|red|green|blue|transparent)$/i],
      'font-family': [/^(?:Arial|Georgia|Verdana|Tahoma|["']?Courier New["']?|["']?Trebuchet MS["']?)$/i],
      'font-size': [/^(?:10|13|18|24|32)px$/], 'text-align': [/^(?:left|center|right|justify)$/],
      'padding-left': [/^(?:3|6|9|12|15|18|21|24)em$/],
      'max-width': [/^100%$/], height: [/^auto$/],
    } },
    transformTags: { img: (tagName, attributes) => {
      const image = inlineImage(attributes.src || '');
      if (!image) return { tagName, attribs: {} };
      imageBytes += image.content.length;
      const attribs: Record<string, string> = { src: attributes.src, alt: (attributes.alt || 'Image').slice(0, 180), style: 'max-width:100%;height:auto' };
      for (const size of ['width', 'height']) if (/^\d{1,4}$/.test(attributes[size] || '')) attribs[size] = attributes[size];
      return { tagName, attribs };
    } },
    exclusiveFilter: frame => frame.tag === 'img' && !frame.attribs.src,
  });
  return { html: sanitized, imageBytes };
}

// MIME CID parts, rather than data URLs, make inline images display in ordinary email clients.
export function composedMimeContent(html: string) {
  const document = parseDocument(html), pending = [...document.children];
  const attachments: { filename: string; contentType: string; content: Buffer; cid: string; contentDisposition: 'inline' }[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if ('children' in node) pending.push(...node.children);
    if ('name' in node && node.name === 'img') {
      const image = inlineImage(node.attribs.src || '');
      if (image) {
        const cid = `fxv-${crypto.randomUUID()}@inline`;
        attachments.push({ filename: `image-${attachments.length + 1}.${image.extension}`, ...image, cid, contentDisposition: 'inline' });
        node.attribs.src = `cid:${cid}`;
      }
    }
  }
  return { html: render(document), attachments };
}
