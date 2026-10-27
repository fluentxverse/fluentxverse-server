export interface ContainerMetrics {
  cpuPercent: number | null;
  memoryBytes: number;
  memoryLimitBytes: number;
  receivedBytes: number;
  sentBytes: number;
  blockReadBytes: number;
  blockWrittenBytes: number;
  pids: number;
}

export interface ContainerRow {
  id: string;
  name: string;
  state: 'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead';
  status: string;
  restartCount?: number | null;
  health?: 'none' | 'healthy' | 'unhealthy' | 'starting' | null;
  metrics: ContainerMetrics | null;
}

export interface ContainerSnapshot {
  version: 1;
  sampledAt: string;
  hostname: string;
  containers: ContainerRow[];
}

export interface ContainerStats {
  status: 'live' | 'partial' | 'stale';
  ageSeconds: number;
  snapshot: ContainerSnapshot;
}
