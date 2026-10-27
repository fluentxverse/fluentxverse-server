export function shouldRetryRead(input: { method?: string; status?: number; aborted?: boolean; code?: string; retried?: boolean }) {
    if (input.retried || input.aborted || input.code === 'ERR_CANCELED' || (input.method || 'get').toLowerCase() !== 'get') return false;
    return input.status === undefined || [408, 425, 429, 502, 503, 504].includes(input.status);
}

export function readRetryDelay(retryAfter?: string, now = Date.now()) {
    if (!retryAfter) return 500;
    const seconds = Number(retryAfter);
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
    return Number.isFinite(milliseconds) ? Math.max(500, Math.min(3000, milliseconds)) : 500;
}
