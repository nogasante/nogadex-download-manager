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
  /** 'once' fires a single start at onceDate+startAtTime and
   *  then consumes itself (disables); recurring keeps a weekly window. */
  once?: boolean;
  /** ISO date (YYYY-MM-DD) for one-time schedules. Defaults to today. */
  onceDate?: string;
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
  /** Guards one-time schedules against double-firing within the same second. */
  private lastOneShotFired: Map<string, string> = new Map();

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

  /**
   * Remove a download from every queue that currently holds it (a download
   * lives in at most one queue, but this is safe against stale duplicates).
   */
  public removeFromAllQueues(downloadId: string): void {
    for (const q of this.queues.values()) {
      const index = q.downloadIds.indexOf(downloadId);
      if (index !== -1) {
        q.downloadIds.splice(index, 1);
        this.emit('queueUpdated', q);
      }
    }
  }

  /**
   * Find the queue a download currently belongs to, if any.
   */
  public findQueueOf(downloadId: string): DownloadQueue | undefined {
    for (const q of this.queues.values()) {
      if (q.downloadIds.includes(downloadId)) return q;
    }
    return undefined;
  }

  /**
   * Auto-assign a newly added download to its queue:
   * 1. Rules-engine routing wins (explicit queueId from a matched rule).
   * 2. Otherwise the download joins the default queue, so queue start/stop
   *    semantics apply to every download, not just rule-matched ones.
   *
   * The default queue's start/stop handlers treat membership as "manage all",
   * so this assignment is what makes stop/hold behavior cover new downloads.
   */
  public autoAssignDownload(downloadId: string, ruleQueueId?: string): DownloadQueue {
    const target = (ruleQueueId && this.queues.get(ruleQueueId)) || this.queues.get('default');
    if (!target) {
      throw new Error('Default queue is missing — QueueSchedulerEngine state corrupted');
    }
    // Reassignment: pull out of any other queue first (single membership).
    for (const q of this.queues.values()) {
      if (q.id === target.id) continue;
      const index = q.downloadIds.indexOf(downloadId);
      if (index !== -1) {
        q.downloadIds.splice(index, 1);
        this.emit('queueUpdated', q);
      }
    }
    if (!target.downloadIds.includes(downloadId)) {
      target.downloadIds.push(downloadId);
      this.emit('queueUpdated', target);
    }
    return target;
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

  /**
   * Update a queue's schedule (merges partial). Returns the updated queue or
   * undefined if the queue id does not exist.
   */
  public updateQueueSchedule(queueId: string, schedulePartial: Partial<QueueSchedule>): DownloadQueue | undefined {
    const q = this.queues.get(queueId);
    if (!q) return undefined;
    q.schedule = { ...q.schedule, ...schedulePartial };
    this.emit('queueUpdated', q);
    return q;
  }

  /**
   * Update queue metadata (name, concurrency). Returns the updated queue or
   * undefined if the queue id does not exist.
   */
  public updateQueueMeta(queueId: string, meta: { name?: string; maxConcurrent?: number }): DownloadQueue | undefined {
    const q = this.queues.get(queueId);
    if (!q) return undefined;
    if (meta.name !== undefined && meta.name.trim()) q.name = meta.name.trim();
    if (meta.maxConcurrent !== undefined) q.maxConcurrent = Math.max(1, Math.min(10, Math.floor(meta.maxConcurrent)));
    this.emit('queueUpdated', q);
    return q;
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
    const todayISO = `${currentTime.getFullYear()}-${pad(currentTime.getMonth() + 1)}-${pad(currentTime.getDate())}`;

    for (const q of this.queues.values()) {
      const s = q.schedule;
      if (!s.enabled) continue;

      if (s.once) {
        // ---- "One-time downloading": fire once at date+time, consume. ----
        if (!s.startAtTime) continue;
        const target = new Date(`${s.onceDate || todayISO}T${s.startAtTime}`);
        if (Number.isNaN(target.getTime())) continue;
        const firedKey = `${s.onceDate || todayISO}T${s.startAtTime}`;
        if (currentTime.getTime() >= target.getTime() && this.lastOneShotFired.get(q.id) !== firedKey) {
          this.lastOneShotFired.set(q.id, firedKey);
          this.startQueue(q.id);
          // The schedule consumes itself: it will not re-arm
          // tomorrow. Persisted via the queueUpdated hook on the server.
          s.enabled = false;
          this.emit('queueUpdated', q);
        }
        // Optional same-day stop for the one-shot run.
        if (s.stopAtTime && q.state === 'running' && curTimeStr >= s.stopAtTime) {
          this.stopQueue(q.id);
        }
        continue;
      }

      // ---- "Periodic synchronization": recurring weekly time window. ----
      // The window belongs to its START day: an overnight window (23:00→07:00)
      // scheduled on Monday covers Monday 23:00 through Tuesday 07:00, even
      // though Tuesday itself is not scheduled. Day rules therefore gate the
      // window computation, not the loop — otherwise a queue that crosses
      // midnight would never stop (the old early-continue bug).
      const dayAllowed = s.daysOfWeek.includes(currentDay);
      const yesterday = (currentDay + 6) % 7;
      const yesterdayAllowed = s.daysOfWeek.includes(yesterday);
      const overnight = !!s.startAtTime && !!s.stopAtTime && s.startAtTime > s.stopAtTime;

      let inWindow: boolean;
      if (!s.startAtTime && !s.stopAtTime) {
        inWindow = true;
      } else if (!s.startAtTime) {
        // Stop-time only: active on scheduled days until the stop time.
        inWindow = dayAllowed && curTimeStr < s.stopAtTime!;
      } else {
        // Start-time portion: on a scheduled day, after start (and before stop
        // for same-day windows).
        const todayIn = dayAllowed
          && curTimeStr >= s.startAtTime
          && (overnight || curTimeStr < s.stopAtTime!);
        // Tail portion: yesterday's overnight window spilling into today.
        const tailIn = yesterdayAllowed && overnight && curTimeStr < s.stopAtTime!;
        inWindow = todayIn || tailIn;
      }

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
