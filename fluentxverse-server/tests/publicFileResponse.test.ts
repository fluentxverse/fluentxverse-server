import { expect, test } from 'bun:test';
import { publicFileResponse } from '../src/utils/publicFileResponse';

test('public media proxy preserves byte ranges, seeking, HEAD and safe cache behavior', async () => {
  const data = '0123456789';
  const reads: { range: string | null; ifRange: string | null; method: string }[] = [];
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
    reads.push({ range: request.headers.get('range'), ifRange: request.headers.get('if-range'), method: request.method });
    if (new URL(request.url).pathname === '/missing') return new Response('missing', { status: 404 });
    const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ETag: '"fixture"' };
    if (new URL(request.url).pathname === '/chunked' && request.method !== 'HEAD') return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(data)); controller.close(); } }), { headers });
    if (request.headers.get('range') === 'bytes=50-') return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': 'bytes */10' } });
    if (request.headers.get('range') === 'bytes=2-5' && request.headers.get('if-range') !== '"old"') return new Response(data.slice(2, 6), { status: 206, headers: { ...headers, 'Content-Length': '4', 'Content-Range': 'bytes 2-5/10' } });
    return new Response(request.method === 'HEAD' ? null : data, { headers: { ...headers, 'Content-Length': '10' } });
  } });
  const url = `http://127.0.0.1:${server.port}`;
  try {
    const partial = await publicFileResponse(url, '/user/fixture/video/intro.mp4', new Request(url, { headers: { Range: 'bytes=2-5', 'If-Range': '"fixture"' } }));
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(partial.headers.get('content-length')).toBe('4');
    expect(partial.headers.get('accept-ranges')).toBe('bytes');
    expect(await partial.text()).toBe('2345');
    expect(reads[0]).toMatchObject({ range: 'bytes=2-5', ifRange: '"fixture"' });
    const stale = await publicFileResponse(url, '/user/fixture/video/intro.mp4', new Request(url, { headers: { Range: 'bytes=2-5', 'If-Range': '"old"' } }));
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe(data);
    const invalid = await publicFileResponse(url, '/user/fixture/video/intro.mp4', new Request(url, { headers: { Range: 'bytes=50-' } }));
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe('bytes */10');
    expect(invalid.headers.get('cache-control')).toBe('no-store');
    const head = await publicFileResponse(url, '/user/fixture/video/intro.mp4', new Request(url, { method: 'HEAD' }));
    expect(head.headers.get('content-length')).toBe('10');
    expect(await head.text()).toBe('');
    expect(reads.at(-1)?.method).toBe('HEAD');
    const chunked = await publicFileResponse(`${url}/chunked`, '/user/fixture/video/intro.mp4', new Request(url));
    expect(chunked.headers.get('content-length')).toBe('10');
    expect(await chunked.text()).toBe(data);
    const missing = await publicFileResponse(`${url}/missing`, '/user/fixture/video/missing.mp4', new Request(url));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    const json = await publicFileResponse(url, '/lessons/fixture/student-data.json', new Request(url));
    expect(json.headers.get('cache-control')).toContain('no-store');
    await json.body?.cancel();
  } finally { server.stop(true); }
});
