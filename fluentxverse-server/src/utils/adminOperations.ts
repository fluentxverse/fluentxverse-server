export const ADMIN_CAPABILITIES = ['support', 'qa', 'operations', 'finance'] as const;
export type AdminCapability = typeof ADMIN_CAPABILITIES[number];
export function adminCapabilities(admin: Record<string, any>): AdminCapability[] {
  if (admin.role === 'superadmin' || admin.permissions == null) return [...ADMIN_CAPABILITIES];
  return ADMIN_CAPABILITIES.filter(key => Array.isArray(admin.permissions) && admin.permissions.includes(key));
}
export function requiredReason(reason: string) {
  const value = reason.trim();
  if (!value || value.length > 1000) throw new Error('A reason between 1 and 1000 characters is required.');
  return value;
}
export function operationsDates(from?: string, to?: string, now = Date.now()) {
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const start = from || today, finish = to || start;
  for (const value of [start, finish]) if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Invalid date range');
  const fromMs = Date.parse(`${start}T00:00:00+08:00`), toMs = Date.parse(`${finish}T00:00:00+08:00`) + 86400000;
  if (toMs <= fromMs || toMs - fromMs > 366 * 86400000) throw new Error('Choose a range of up to 366 days.');
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), start, finish };
}
export function plainNode(value: any): any {
  if (value?.toStandardDate) return value.toStandardDate().toISOString();
  if (value?.toNumber) return value.toNumber();
  if (Array.isArray(value)) return value.map(plainNode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plainNode(item)]));
  return value;
}
