/** Preserve byte ranges so browsers can read MP4 metadata and seek without downloading the entire upload. */
export async function publicFileResponse(url: string, path: string, request: Request): Promise<Response> {
  const headers = new Headers();
  for (const name of ['range', 'if-range']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstream = await fetch(url, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers, signal: request.signal });
  const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of ['content-type', 'accept-ranges', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (upstream.status === 416) {
    await upstream.body?.cancel();
    return new Response(null, { status: 416, headers: responseHeaders });
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return Response.json({ error: 'File not found' }, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  }
  let length = upstream.headers.get('content-length');
  if (!length && upstream.status === 200 && request.method !== 'HEAD' && upstream.headers.get('content-type')?.startsWith('video/')) {
    // SeaweedFS streams full videos without a length; the CDN needs it to serve cached byte ranges.
    const metadata = await fetch(url, { method: 'HEAD', signal: request.signal });
    if (metadata.ok && upstream.headers.get('etag') && metadata.headers.get('etag') === upstream.headers.get('etag')) length = metadata.headers.get('content-length');
    await metadata.body?.cancel();
  }
  if (length && !upstream.headers.has('content-encoding')) responseHeaders.set('Content-Length', length);
  const dynamic = path.endsWith('.html') || path.endsWith('.json');
  responseHeaders.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
  responseHeaders.set('Cache-Control', dynamic ? 'no-store, max-age=0' : 'public, max-age=31536000');
  if (dynamic) { responseHeaders.set('Pragma', 'no-cache'); responseHeaders.set('Expires', '0'); }
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
}
