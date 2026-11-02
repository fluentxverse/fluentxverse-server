// Bun's fetch also exposes preconnect. Keep fixtures network-free while matching
// the full callable API expected by spyOn(globalThis, 'fetch').
export function fixtureFetch(handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): typeof fetch {
  return Object.assign(handler, { preconnect: () => {} });
}
