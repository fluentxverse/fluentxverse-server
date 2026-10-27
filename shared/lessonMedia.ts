/** Resolve persisted storage URLs without relying on a retired public domain. */
export function resolveMediaUrl(value: string | null | undefined, apiBase: string): string | undefined {
  if (!value?.trim()) return undefined;
  const source = value.trim();
  const base = apiBase.trim().replace(/\/+$/, '');
  if (source.startsWith('/lesson/files/')) return `${base}${source}`;
  if (source.startsWith('/lessons/') || source.startsWith('/user/')) return `${base}/lesson/files${source}`;
  try {
    const url = new URL(source.startsWith('//') ? `https:${source}` : source);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return source;
    const ownedApi = ['api.fluentxverse.xyz', 'api.fluentxverse.com'].includes(url.hostname) && !url.port;
    const localApi = ['localhost', '127.0.0.1'].includes(url.hostname) && ['8765', '8780', '8782'].includes(url.port);
    const internalFiler = (['fluentxverse-seaweed-filer', 'seaweed-filer'].includes(url.hostname) && ['', '8888'].includes(url.port))
      || (['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '8888');
    const suffix = `${url.pathname}${url.search}${url.hash}`;
    if ((ownedApi || localApi) && url.pathname.startsWith('/lesson/files/')) return `${base}${suffix}`;
    if ((ownedApi || internalFiler) && (url.pathname.startsWith('/lessons/') || url.pathname.startsWith('/user/'))) {
      return `${base}/lesson/files${suffix}`;
    }
  } catch {
    // App assets, external media and local upload previews remain unchanged.
  }
  return source;
}

function resolveLessonText(value: string, apiBase: string): string {
  const resolved = resolveMediaUrl(value, apiBase);
  if (resolved && resolved !== value.trim()) return resolved;
  if (/^(?:(?:https?:)?\/\/|data:|blob:)/i.test(value.trim())) return value;
  if (!value.includes('<') || typeof DOMParser === 'undefined') return value;

  // Rich-text fragments can contain image/video URLs outside dedicated image fields.
  const document = new DOMParser().parseFromString(value, 'text/html');
  let changed = false;
  for (const element of document.querySelectorAll('[src], [poster]')) {
    for (const attribute of ['src', 'poster']) {
      const original = element.getAttribute(attribute);
      const next = resolveMediaUrl(original, apiBase);
      if (original && next && next !== original) {
        element.setAttribute(attribute, next);
        changed = true;
      }
    }
  }
  if (!changed) return value;
  return /<!doctype|<html[\s>]/i.test(value)
    ? `${document.doctype ? '<!DOCTYPE html>' : ''}${document.documentElement.outerHTML}`
    : document.body.innerHTML;
}

/** Normalize JSON lesson payloads, including arrays and rich-text media, without mutating drafts. */
export function normalizeLessonMedia<T>(data: T, apiBase: string): T {
  if (typeof data === 'string') return resolveLessonText(data, apiBase) as T;
  if (Array.isArray(data)) return data.map(item => normalizeLessonMedia(item, apiBase)) as T;
  if (data && typeof data === 'object' && Object.getPrototypeOf(data) === Object.prototype) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, normalizeLessonMedia(value, apiBase)])) as T;
  }
  return data;
}

export function isLessonMediaRequest(url: string | undefined): boolean {
  try {
    return /^\/(?:lesson-materials|lesson|young-learners|dispatch)(?:\/|$)/.test(new URL(url || '', 'https://lesson.invalid').pathname);
  } catch {
    return false;
  }
}
