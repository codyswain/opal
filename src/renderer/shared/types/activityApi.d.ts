import type { DiskResult } from '@/types/disk';
import type { RecentQuery, RecentResult } from '@/types/activity';

export interface ActivityAPI {
  record: (target: string, kind: 'opened') => Promise<DiskResult>;
  recent: (query?: RecentQuery) => Promise<DiskResult<RecentResult>>;
  clear: () => Promise<DiskResult>;
  onChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    activityAPI: ActivityAPI;
  }
}
