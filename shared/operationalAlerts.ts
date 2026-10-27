export type AlertSeverity = 'warning' | 'critical';
export type AlertCategory = 'availability' | 'disk' | 'containers' | 'recordings' | 'proofs' | 'monitoring';
export interface OperationalIncident {
  id: string; key: string; category: AlertCategory; severity: AlertSeverity;
  title: string; message: string; href: string;
  openedAt: string; lastSeenAt: string; resolvedAt: string | null;
  acknowledgedAt: string | null; acknowledgedBy: string | null;
  events: { at: string; action: 'opened' | 'acknowledged' | 'escalated' | 'resolved'; actor?: string }[];
}
export interface AlertSnapshot {
  version: 1; checkedAt: string | null; apiAvailable: boolean | null;
  incidents: OperationalIncident[];
  notifications: { browser: boolean; external: boolean };
}
export interface AlertTelemetry {
  version: 1; sampledAt: string;
  host: { diskUsedPercent: number; diskAvailableBytes: number } | null;
  containers: { id: string; name: string; state: string; restartCount: number | null; health: string | null }[] | null;
  recordings: { failed: number; overdue: number } | null;
  proofs: { pending: number; oldestAt: string | null; missingTimestamp: number } | null;
}
