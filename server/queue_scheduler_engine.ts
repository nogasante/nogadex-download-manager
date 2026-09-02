import { EventEmitter } from 'events';

export type QueueState = 'stopped' | 'running' | 'paused' | 'scheduled' | 'completed';

export interface QueueSchedule {
  enabled: boolean;
  startAtTime?: string; // "23:00:00"
  stopAtTime?: string;  // "07:30:00"
  daysOfWeek: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  actionOnComplete: 'none' | 'stop_queue' | 'pause_queue' | 'notification' | 'shutdown';
  maxRetries: number;
  speedLimitKB?: number;
}

export interface DownloadQueue {
  id: string;
  name: string;
  maxConcurrent: number;
  state: QueueState;
  downloadIds: string[];
  schedule: QueueSchedule;
  createdAt: number;
}

export class QueueSchedulerEngine extends EventEmitter {
  private queues: Map<string, DownloadQueue> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Initialize Default Queue
    this.createQueue('default', 'Default Queue', 3, {
      enabled: false,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      actionOnComplete: 'none',
      maxRetries: 5,
    });
    this.startSchedulerLoop();
  }

  public createQueue(id: string, name: string, maxConcurrent = 3, schedulePartial?: Partial<QueueSchedule>): DownloadQueue {
    const queue: DownloadQueue = {
      id,
      name,
      maxConcurrent: Math.max(1, Math.min(10, maxConcurrent)),
      state: 'stopped',
      downloadIds: [],
      schedule: {
        enabled: false,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        actionOnComplete: 'none',
        maxRetries: 5,
        ...schedulePartial,
      },
      createdAt: Date.now(),
    };
    this.queues.set(id, queue);
    this.emit('queueCreated', queue);
    return queue;
  }

  public getQueues(): DownloadQueue[] {
    return Array.from(this.queues.values());
  }

  public getQueue(id: string): DownloadQueue | undefined {
    return this.queues.get(id);
  }

  public deleteQueue(id: string): boolean {
    if (id === 'default') return false; // cannot delete default queue
    const res = this.queues.delete(id);
    if (res) this.emit('queueDeleted', id);
    return res;
  }

  public addToQueue(queueId: string, downloadId: string): boolean {
    const q = this.queues.get(queueId);
    if (!q) return false;
    if (!q.downloadIds.includes(downloadId)) {
      q.downloadIds.push(downloadId);
      this.emit('queueUpdated', q);
    }
    return true;
  }

  public removeFromQueue(queueId: string, downloadId: string): boolean {
    const q = this.queues.get(queueId);
    if (!q) return false;
    const index = q.downloadIds.indexOf(downloadId);
    if (index !== -1) {
      q.downloadIds.splice(index, 1);
      this.emit('queueUpdated', q);
      return true;
    }
    return false;
  }

  public reorderItem(queueId: string, downloadId: string, targetPosition: 'top' | 'up' | 'down' | 'bottom'): boolean {
    const q = this.queues.get(queueId);
    if (!q) return false;
    const idx = q.downloadIds.indexOf(downloadId);
    if (idx === -1) return false;

    q.downloadIds.splice(idx, 1);
    if (targetPosition === 'top') {
      q.downloadIds.unshift(downloadId);
    } else if (targetPosition === 'bottom') {
      q.downloadIds.push(downloadId);
    } else if (targetPosition === 'up') {
      const newIdx = Math.max(0, idx - 1);
      q.downloadIds.splice(newIdx, 0, downloadId);
    } else if (targetPosition === 'down') {
      const newIdx = Math.min(q.downloadIds.length, idx + 1);
      q.downloadIds.splice(newIdx, 0, downloadId);
    }
    this.emit('queueUpdated', q);
    return true;
  }

  public startQueue(queueId: string): boolean {
    const q = this.queues.get(queueId);
    if (!q) return false;
    q.state = 'running';
    this.emit('queueStarted', q);
    return true;
  }

  public stopQueue(queueId: string): boolean {
    const q = this.queues.get(queueId);
    if (!q) return false;
    q.state = 'stopped';
    this.emit('queueStopped', q);
    return true;
  }

  public pauseQueue(queueId: string): boolean {
    const q = this.queues.get(queueId);
    if (!q) return false;
    q.state = 'paused';
    this.emit('queuePaused', q);
    return true;
  }

  public isTimeInWindow(curTimeStr: string, start?: string, stop?: string): boolean {
    if (!start && !stop) return true;
    if (start && !stop) return curTimeStr >= start;
    if (!start && stop) return curTimeStr < stop;
    if (start && stop) {
      if (start <= stop) {
        // Normal daytime window (e.g. 09:00 to 17:00)
        return curTimeStr >= start && curTimeStr < stop;
      } else {
        // Overnight window (e.g. 23:00 to 07:00)
        return curTimeStr >= start || curTimeStr < stop;
      }
    }
    return true;
  }

  public checkSchedules(currentTime = new Date()): void {
    const currentDay = currentTime.getDay();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const curTimeStr = `${pad(currentTime.getHours())}:${pad(currentTime.getMinutes())}:${pad(currentTime.getSeconds())}`;

    for (const q of this.queues.values()) {
      if (!q.schedule.enabled) continue;
      if (!q.schedule.daysOfWeek.includes(currentDay)) continue;

      const inWindow = this.isTimeInWindow(curTimeStr, q.schedule.startAtTime, q.schedule.stopAtTime);

      if (inWindow && q.state !== 'running') {
        this.startQueue(q.id);
      } else if (!inWindow && q.state === 'running') {
        this.stopQueue(q.id);
      }
    }
  }

  public destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private startSchedulerLoop(): void {
    this.checkInterval = setInterval(() => {
      this.checkSchedules();
    }, 1000);
  }
}
