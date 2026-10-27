const prefix = 'fxv:form-draft:v1:';
const lifetime = 4 * 60 * 60 * 1000;
export function sessionDraftKey(userId: string, scope: string, recordId: string) {
    return `${prefix}${encodeURIComponent(userId)}:${encodeURIComponent(scope)}:${encodeURIComponent(recordId)}`;
}
export function readSessionDraft<T>(storage: Storage, key: string, valid: (value: unknown) => value is T, now = Date.now()): T | null {
    try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (!Number.isFinite(entry.savedAt) || entry.savedAt > now || now - entry.savedAt > lifetime || !valid(entry.value)) {
            storage.removeItem(key); return null;
        }
        return entry.value;
    } catch { return null; }
}
// Only non-credential form content belongs here; storage is tab-local and expires.
export function saveSessionDraft(storage: Storage, key: string, value: unknown, now = Date.now()) {
    try {
        const raw = JSON.stringify({ savedAt: now, value });
        if (raw.length > 12000) return false;
        storage.setItem(key, raw); return true;
    } catch { return false; }
}
export function clearSessionDrafts(storage: Storage) {
    try {
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
        for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
    } catch { /* Storage can be blocked without preventing sign-out. */ }
}
