export interface QueuedItem {
  id: string;
  url: string;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'error';
  priority: number; // 0 = highest
  addedAt: number;
}

export class QueueManager {
  private queue: QueuedItem[] = [];
  private maxActive: number;

  constructor(maxActive: number = 3) {
    this.maxActive = Math.max(1, maxActive);
  }

  public setMaxActive(max: number): void {
    this.maxActive = Math.max(1, max);
  }

  public getMaxActive(): number {
    return this.maxActive;
  }

  public addItem(id: string, url: string, startImmediate: boolean = true): { status: 'downloading' | 'queued' } {
    const activeCount = this.getActiveCount();
    const shouldStart = startImmediate && (activeCount < this.maxActive);
    const initialStatus = shouldStart ? 'downloading' : 'queued';

    const item: QueuedItem = {
      id,
      url,
      status: initialStatus,
      priority: this.queue.length,
      addedAt: Date.now()
    };

    this.queue.push(item);
    return { status: initialStatus };
  }

  public getActiveCount(): number {
    return this.queue.filter(i => i.status === 'downloading').length;
  }

  public getQueuedCount(): number {
    return this.queue.filter(i => i.status === 'queued').length;
  }

  public getQueue(): QueuedItem[] {
    return [...this.queue];
  }

  public getItem(id: string): QueuedItem | undefined {
    return this.queue.find(i => i.id === id);
  }

  public markStatus(id: string, status: 'downloading' | 'paused' | 'completed' | 'error'): string[] {
    const item = this.getItem(id);
    if (item) {
      item.status = status;
    }

    // When an active item completes, pauses, or errors, promote the next queued item
    return this.checkAndPromote();
  }

  public checkAndPromote(): string[] {
    const promotedIds: string[] = [];
    const activeCount = this.getActiveCount();
    const availableSlots = this.maxActive - activeCount;

    if (availableSlots > 0) {
      const queuedItems = this.queue
        .filter(i => i.status === 'queued')
        .sort((a, b) => a.priority - b.priority);

      for (let i = 0; i < Math.min(availableSlots, queuedItems.length); i++) {
        queuedItems[i].status = 'downloading';
        promotedIds.push(queuedItems[i].id);
      }
    }

    return promotedIds;
  }

  public reorder(id: string, direction: 'up' | 'down' | 'top' | 'bottom'): boolean {
    const idx = this.queue.findIndex(i => i.id === id);
    if (idx === -1) return false;

    const item = this.queue[idx];
    if (direction === 'up' && idx > 0) {
      this.queue.splice(idx, 1);
      this.queue.splice(idx - 1, 0, item);
    } else if (direction === 'down' && idx < this.queue.length - 1) {
      this.queue.splice(idx, 1);
      this.queue.splice(idx + 1, 0, item);
    } else if (direction === 'top') {
      this.queue.splice(idx, 1);
      this.queue.unshift(item);
    } else if (direction === 'bottom') {
      this.queue.splice(idx, 1);
      this.queue.push(item);
    }

    // Re-index priorities
    this.queue.forEach((it, index) => {
      it.priority = index;
    });

    return true;
  }

  public pauseAll(): string[] {
    const pausedIds: string[] = [];
    this.queue.forEach(item => {
      if (item.status === 'downloading' || item.status === 'queued') {
        item.status = 'paused';
        pausedIds.push(item.id);
      }
    });
    return pausedIds;
  }

  public resumeAll(): string[] {
    this.queue.forEach(item => {
      if (item.status === 'paused') {
        item.status = 'queued';
      }
    });
    return this.checkAndPromote();
  }

  public removeItem(id: string): string[] {
    this.queue = this.queue.filter(i => i.id !== id);
    return this.checkAndPromote();
  }
}
