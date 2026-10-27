export interface HostCapacity {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
}

export interface ServerHealthSnapshot {
  version: 1;
  sampledAt: string;
  hostname: string;
  uptimeSeconds: number;
  cpu: { model: string; cores: number; usagePercent: number | null };
  memory: HostCapacity;
  disk: HostCapacity;
  network: {
    interface: string;
    addresses: string[];
    receivedBytes: number;
    sentBytes: number;
    receiveBytesPerSecond: number | null;
    sendBytesPerSecond: number | null;
  };
  bandwidth: { allowanceBytes: number; billingSource: 'not_connected' };
}

export interface ServerHealth {
  status: 'live' | 'stale';
  ageSeconds: number;
  snapshot: ServerHealthSnapshot;
}
