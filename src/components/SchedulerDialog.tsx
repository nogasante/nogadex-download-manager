import React, { useState, useEffect, useCallback } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { MessageBoxDialog, MessageBoxOptions } from './MessageBoxDialog';
import { WinCheckbox, WinRadio, WinInput, WinButton, WinSelect, WinTabs } from './common/WinControls';
import { DownloadItem } from '../types/download';
import { api } from '../api/client';
import { getApiBaseUrl } from '../config/apiConfig';
import { APP_NAME } from '../config/appInfo';

export interface QueueItem {
  id: string;
  name: string;
  maxConcurrent: number;
  state: 'stopped' | 'running' | 'paused' | 'scheduled' | 'completed';
  downloadIds: string[];
  schedule?: {
    enabled: boolean;
    startAtTime?: string;
    stopAtTime?: string;
    daysOfWeek: number[];
    actionOnComplete?: string;
    maxRetries?: number;
    /** One-shot semantics: fires at onceDate+startAtTime, then disarms. */
    once?: boolean;
    /** ISO date (YYYY-MM-DD) the one-time schedule fires on. */
    onceDate?: string;
  };
}

interface VolumeLimits {
  enabled: boolean;
  limitMB: number;
  periodHours: number;
  showWarning: boolean;
  usedMB?: number;
}

const DAY_KEYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

interface SchedulerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  downloads?: DownloadItem[];
  onStartQueue?: () => void;
  onStopQueue?: () => void;
  isStandalone?: boolean;
}

export const SchedulerDialog: React.FC<SchedulerDialogProps> = ({
  isOpen,
  onClose,
  downloads = [],
  isStandalone = false,
}) => {
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState<string>('default');
  // 'limits' is the download-limits pseudo-entry in the queues list.
  const [activePane, setActivePane] = useState<'queue' | 'limits'>('queue');
  const [activeTab, setActiveTab] = useState<'schedule' | 'files'>('schedule');

  // Schedule form state (hydrated from the selected queue, saved via Apply)
  const [scheduleType, setScheduleType] = useState<'periodic' | 'onetime'>('onetime');
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [enableStart, setEnableStart] = useState(false);
  const [startTime, setStartTime] = useState('23:00');
  const [enableStop, setEnableStop] = useState(false);
  const [stopTime, setStopTime] = useState('07:30');
  const [simultaneousDownloads, setSimultaneousDownloads] = useState(3);
  const [retries, setRetries] = useState(10);
  const [shutdownOnComplete, setShutdownOnComplete] = useState(false);
  /** ISO date (YYYY-MM-DD) for One-time downloading (date dropdown). */
  const [onceDate, setOnceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Download limits pane state
  const [limits, setLimits] = useState<VolumeLimits>({ enabled: false, limitMB: 200, periodHours: 5, showWarning: true });

  // Prompt modal state for creating new queue
  const [isCreatingQueue, setIsCreatingQueue] = useState(false);
  const [newQueueName, setNewQueueName] = useState('');
  const [msgBox, setMsgBox] = useState<MessageBoxOptions | null>(null);

  const selectedQueue = queues.find((q) => q.id === selectedQueueId);
  const isQueueActive = selectedQueue?.state === 'running';

  const fetchQueues = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/queues`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setQueues(data);
          if (!data.some((q: QueueItem) => q.id === selectedQueueId)) {
            setSelectedQueueId(data[0].id);
          }
        }
      }
    } catch {}
  }, [selectedQueueId]);

  const fetchLimits = useCallback(async () => {
    try {
      const l = await api.volumeLimits.get();
      setLimits(l);
    } catch {}
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchQueues();
      fetchLimits();
    }
  }, [isOpen]);

  // Hydrate the schedule form whenever the selected queue changes
  useEffect(() => {
    const q = queues.find((x) => x.id === selectedQueueId);
    if (!q?.schedule) return;
    const s = q.schedule;
    setEnableStart(Boolean(s.startAtTime));
    if (s.startAtTime) setStartTime(s.startAtTime.slice(0, 5));
    setEnableStop(Boolean(s.stopAtTime));
    if (s.stopAtTime) setStopTime(s.stopAtTime.slice(0, 5));
    setSelectedDays(new Set(s.daysOfWeek?.length ? s.daysOfWeek : [0, 1, 2, 3, 4, 5, 6]));
    setRetries(typeof s.maxRetries === 'number' ? s.maxRetries : 10);
    setShutdownOnComplete(s.actionOnComplete === 'shutdown');
    setSimultaneousDownloads(q.maxConcurrent || 3);
    setScheduleType(s.once ? 'onetime' : 'periodic');
    setOnceDate(s.onceDate || new Date().toISOString().slice(0, 10));
  }, [selectedQueueId, queues.length]);

  const toggleDay = (dayIdx: number) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayIdx)) next.delete(dayIdx);
      else next.add(dayIdx);
      return next;
    });
  };

  const handleCreateQueue = async () => {
    if (!newQueueName.trim()) return;
    const nameToCreate = newQueueName.trim();
    setNewQueueName('');
    setIsCreatingQueue(false);
    try {
      const created = await fetch(`${getApiBaseUrl()}/api/queues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameToCreate, maxConcurrent: simultaneousDownloads }),
      });
      if (created.ok) {
        const json = await created.json();
        await fetchQueues();
        if (json?.id) setSelectedQueueId(json.id);
      }
    } catch {}
  };

  const handleDeleteQueue = async (queueId: string) => {
    if (queueId === 'default') return;
    try {
      await fetch(`${getApiBaseUrl()}/api/queues/${encodeURIComponent(queueId)}`, { method: 'DELETE' });
      setSelectedQueueId('default');
      await fetchQueues();
    } catch {}
  };

  const handleStartQueue = async () => {
    try {
      await api.queues.start(selectedQueueId);
      await fetchQueues();
      setMsgBox({
        title: APP_NAME,
        type: 'info',
        message: `Queue "${selectedQueue?.name || selectedQueueId}" is now running.`,
      });
    } catch {}
  };

  const handleStopQueue = async () => {
    try {
      await api.queues.stop(selectedQueueId);
      await fetchQueues();
    } catch {}
  };

  /** Scheduler Apply: persist the schedule to the engine. */
  const handleApplySchedule = async () => {
    if (!selectedQueue) return;
    try {
      await api.queues.saveSchedule(selectedQueueId, {
        schedule: {
          enabled: enableStart || enableStop,
          startAtTime: enableStart ? `${startTime}:00` : undefined,
          stopAtTime: enableStop ? `${stopTime}:00` : undefined,
          daysOfWeek: selectedDays.size ? Array.from(selectedDays) : [0, 1, 2, 3, 4, 5, 6],
          actionOnComplete: shutdownOnComplete ? 'shutdown' : 'none',
          maxRetries: retries,
          once: scheduleType === 'onetime',
          onceDate: scheduleType === 'onetime' ? onceDate : undefined,
        },
        maxConcurrent: simultaneousDownloads,
      });
      await fetchQueues();
      setMsgBox({
        title: APP_NAME,
        type: 'info',
        message:
          scheduleType === 'onetime'
            ? `One-time schedule saved: "${selectedQueue.name}" starts on ${onceDate} at ${startTime}, then the schedule disarms.`
            : `Weekly schedule saved: "${selectedQueue.name}" runs ${selectedDays.size === 7 ? 'every day' : `${selectedDays.size} day(s)/week`} from ${startTime} to ${enableStop ? stopTime : '(no stop time)'}.`,
      });
    } catch {
      setMsgBox({ title: APP_NAME, type: 'error', message: 'Failed to save the schedule.' });
    }
  };

  const handleSaveLimits = async () => {
    try {
      const res = await api.volumeLimits.save({
        enabled: limits.enabled,
        limitMB: limits.limitMB,
        periodHours: limits.periodHours,
        showWarning: limits.showWarning,
      });
      setLimits((prev) => ({ ...prev, usedMB: res.usedMB ?? prev.usedMB }));
      setMsgBox({
        title: APP_NAME,
        type: 'info',
        message: limits.enabled
          ? `Download limit saved: ${limits.limitMB} MB every ${limits.periodHours} h.`
          : 'Download limits disabled.',
      });
    } catch {
      setMsgBox({ title: APP_NAME, type: 'error', message: 'Failed to save download limits.' });
    }
  };

  const queuedDownloads = downloads.filter((d) => {
    if (selectedQueueId === 'default') {
      return d.status === 'queued' || d.status === 'downloading' || d.status === 'paused';
    }
    return selectedQueue?.downloadIds?.includes(d.id);
  });

  const footer = (
    <div className="w-full flex items-center justify-between">
      <div className="flex items-center gap-2">
        <WinButton
          variant="primary"
          onClick={handleStartQueue}
          disabled={activePane !== 'queue' || isQueueActive}
          className="min-w-[92px]"
        >
          Start now
        </WinButton>
        <WinButton
          variant="secondary"
          onClick={handleStopQueue}
          disabled={activePane !== 'queue' || !isQueueActive}
          className="min-w-[70px]"
        >
          Stop
        </WinButton>
      </div>
      <div className="flex items-center gap-2">
        {activePane === 'queue' ? (
          <WinButton variant="primary" onClick={handleApplySchedule} className="min-w-[80px]">
            Apply
          </WinButton>
        ) : (
          <WinButton variant="primary" onClick={handleSaveLimits} className="min-w-[80px]">
            Apply
          </WinButton>
        )}
        <WinButton variant="secondary" onClick={onClose} className="min-w-[84px]">
          Close
        </WinButton>
      </div>
    </div>
  );

  const tabs = [
    { id: 'schedule', label: 'Schedule' },
    { id: 'files', label: `Files in the queue (${queuedDownloads.length})` },
  ];

  return (
    <>
      <WindowsDialog
        isOpen={isOpen}
        onClose={onClose}
        title="Scheduler"
        width="w-[680px]"
        footer={footer}
        isStandalone={isStandalone}
      >
        <div className="grid grid-cols-[170px_1fr] gap-3 min-h-[320px]">
          {/* Left: Queues list */}
          <div className="border border-neutral-300 bg-neutral-50 p-2 flex flex-col justify-between rounded-[2px]">
            <div className="space-y-0.5 overflow-y-auto max-h-[300px]">
              <div className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-1">
                Queues
              </div>
              {queues.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => { setSelectedQueueId(q.id); setActivePane('queue'); }}
                  className={`w-full text-left px-2 py-1 rounded-[2px] font-semibold text-[11.5px] flex items-center justify-between transition-colors ${
                    activePane === 'queue' && selectedQueueId === q.id
                      ? 'bg-brand-tint border border-brand-tintEdge text-brand'
                      : 'hover:bg-neutral-200 border border-transparent text-neutral-700'
                  }`}
                >
                  <span className="truncate">{q.name}</span>
                  {q.state === 'running' && (
                    <span className="w-2 h-2 rounded-full bg-status-completed animate-pulse" title="Running" />
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setActivePane('limits')}
                className={`w-full text-left px-2 py-1 rounded-[2px] font-semibold text-[11.5px] flex items-center gap-1.5 transition-colors ${
                  activePane === 'limits'
                    ? 'bg-brand-tint border border-brand-tintEdge text-brand'
                    : 'hover:bg-neutral-200 border border-transparent text-neutral-700'
                }`}
              >
                <span aria-hidden>⚠️</span>
                <span className="truncate">Download limits</span>
              </button>
            </div>

            <div className="flex gap-1 pt-2 border-t border-neutral-200">
              <button
                type="button"
                onClick={() => setIsCreatingQueue(true)}
                className="flex-1 h-[24px] bg-white border border-neutral-300 hover:bg-neutral-100 rounded-[2px] text-[11px] font-medium text-neutral-800 cursor-pointer"
              >
                New queue
              </button>
              <button
                type="button"
                disabled={activePane !== 'queue' || selectedQueueId === 'default'}
                onClick={() => handleDeleteQueue(selectedQueueId)}
                className="px-2 h-[24px] bg-white border border-neutral-300 text-status-error disabled:opacity-40 disabled:cursor-not-allowed hover:bg-status-errorBg rounded-[2px] text-[11px] font-medium cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>

          {/* Right pane */}
          <div className="space-y-3 min-w-0">
            {activePane === 'limits' ? (
              /* ---------------- Download limits pane ---------------- */
              <div className="space-y-3">
                <WinCheckbox
                  checked={limits.enabled}
                  onChange={(v) => setLimits((p) => ({ ...p, enabled: v }))}
                  label={<span className="font-semibold">Download limits</span>}
                />
                <div className={`space-y-2 pl-6 ${limits.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                  <div className="grid grid-cols-[auto_70px_auto] items-center gap-2 text-[12px]">
                    <span className="text-neutral-600">Download no more than</span>
                    <WinInput
                      type="number"
                      min={1}
                      value={limits.limitMB}
                      onChange={(e) => setLimits((p) => ({ ...p, limitMB: Math.max(1, Number(e.target.value) || 1) }))}
                      className="h-[26px] text-center"
                    />
                    <span className="text-neutral-600">MBytes</span>
                  </div>
                  <div className="grid grid-cols-[auto_70px_auto] items-center gap-2 text-[12px]">
                    <span className="text-neutral-600">every</span>
                    <WinInput
                      type="number"
                      min={1}
                      max={168}
                      value={limits.periodHours}
                      onChange={(e) => setLimits((p) => ({ ...p, periodHours: Math.max(1, Number(e.target.value) || 1) }))}
                      className="h-[26px] text-center"
                    />
                    <span className="text-neutral-600">hours</span>
                  </div>
                  <div className="text-[11.5px] text-neutral-500">
                    {typeof limits.usedMB === 'number'
                      ? `Used in the current window: ${limits.usedMB} MB of ${limits.limitMB} MB. When the quota is reached, downloads pause until the window slides open again.`
                      : 'Counts data delivered to disk over the trailing window; downloads pause when the quota is exhausted.'}
                  </div>
                </div>
                <WinCheckbox
                  checked={limits.showWarning}
                  onChange={(v) => setLimits((p) => ({ ...p, showWarning: v }))}
                  label="Show warning before stopping downloads"
                />
              </div>
            ) : (
              /* ---------------- Queue pane (Schedule / Files) ---------------- */
              <>
                <div className="text-[12.5px] font-semibold text-neutral-700 text-center border-b border-neutral-200 pb-1.5">
                  {selectedQueue?.name || 'Queue'}
                </div>
                <WinTabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as any)} />

                {activeTab === 'schedule' ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-5 text-[12px]">
                      <WinRadio
                        checked={scheduleType === 'onetime'}
                        onChange={() => setScheduleType('onetime')}
                        label="One-time downloading"
                      />
                      <WinRadio
                        checked={scheduleType === 'periodic'}
                        onChange={() => setScheduleType('periodic')}
                        label="Periodic synchronization"
                      />
                    </div>

                    <div className="h-[1px] bg-neutral-200" />

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <WinCheckbox
                          checked={enableStart}
                          onChange={setEnableStart}
                          label="Start download at"
                        />
                        <WinInput
                          type="time"
                          disabled={!enableStart}
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                          className="h-[26px] text-[11.5px] w-[110px]"
                        />
                        {scheduleType === 'onetime' && (
                          <WinInput
                            type="date"
                            disabled={!enableStart}
                            value={onceDate}
                            onChange={(e) => setOnceDate(e.target.value)}
                            className="h-[26px] text-[11.5px] w-[150px]"
                            title="One-time: the queue starts on this date at the time above, then the schedule disarms"
                          />
                        )}
                      </div>

                      {/* One-time = single date+time; Periodic = weekly day grid. */}
                      {scheduleType === 'periodic' && (
                        <div className="pl-6 grid grid-cols-3 gap-x-3 gap-y-1">
                          {DAY_KEYS.map((d, idx) => (
                            <WinCheckbox
                              key={d}
                              checked={selectedDays.has(idx)}
                              onChange={() => toggleDay(idx)}
                              disabled={!enableStart}
                              label={<span className="text-[11.5px]">{d}</span>}
                            />
                          ))}
                          <div className="col-span-3 text-[11px] text-neutral-500 italic">
                            Runs every week on the checked days during the start/stop window.
                          </div>
                        </div>
                      )}
                      {scheduleType === 'onetime' && (
                        <div className="pl-6 text-[11px] text-neutral-500 italic">
                          Fires once on the chosen date at the start time, then the schedule disarms itself.
                        </div>
                      )}
                    </div>

                    <div className="h-[1px] bg-neutral-200" />

                    <div className="flex items-center gap-2">
                      <WinCheckbox
                        checked={enableStop}
                        onChange={setEnableStop}
                        label="Stop download at"
                      />
                      <WinInput
                        type="time"
                        disabled={!enableStop}
                        value={stopTime}
                        onChange={(e) => setStopTime(e.target.value)}
                        className="h-[26px] text-[11.5px] w-[110px]"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <WinCheckbox
                        checked={retries > 0}
                        onChange={(v) => setRetries(v ? 10 : 0)}
                        label="Number of retries for each file if downloading failed:"
                      />
                      <WinInput
                        type="number"
                        min={0}
                        max={20}
                        disabled={retries <= 0}
                        value={retries}
                        onChange={(e) => setRetries(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
                        className="h-[26px] text-[11.5px] w-[64px] text-center"
                      />
                    </div>

                    <div className="h-[1px] bg-neutral-200" />

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-neutral-600 text-[12px] w-[150px]">Simultaneous downloads:</span>
                        <WinSelect
                          value={simultaneousDownloads}
                          onChange={(e) => setSimultaneousDownloads(Number(e.target.value))}
                          className="w-[90px] h-[26px] text-[11.5px]"
                        >
                          <option value={1}>1 file</option>
                          <option value={2}>2 files</option>
                          <option value={3}>3 files</option>
                          <option value={5}>5 files</option>
                          <option value={8}>8 files</option>
                        </WinSelect>
                      </div>
                      <WinCheckbox
                        checked={shutdownOnComplete}
                        onChange={setShutdownOnComplete}
                        label="Turn off computer when done"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="border border-neutral-300 bg-neutral-50 h-56 overflow-y-auto rounded-[2px]">
                    {queuedDownloads.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-neutral-400 italic text-[11px]">
                        No files currently in this queue.
                      </div>
                    ) : (
                      <div className="divide-y divide-neutral-200">
                        {queuedDownloads.map((item, idx) => (
                          <div key={item.id} className="p-2 flex items-center justify-between text-[11.5px] hover:bg-neutral-100">
                            <div className="truncate pr-2">
                              <span className="font-mono text-neutral-500 mr-2">#{idx + 1}</span>
                              <span className="font-semibold text-neutral-900">{item.filename}</span>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[10.5px] capitalize font-medium ${
                              item.status === 'downloading'
                                ? 'bg-status-downloadingBg text-brand-glow'
                                : item.status === 'completed'
                                ? 'bg-status-completedBg text-status-completed'
                                : 'bg-neutral-100 text-neutral-500'
                            }`}>
                              {item.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </WindowsDialog>

      {/* New Queue Prompt Modal */}
      {isCreatingQueue && (
        <WindowsDialog
          isOpen={isCreatingQueue}
          onClose={() => setIsCreatingQueue(false)}
          title="New Download Queue"
          width="w-[380px]"
          footer={
            <>
              <WinButton
                variant="primary"
                onClick={handleCreateQueue}
                disabled={!newQueueName.trim()}
                className="min-w-[80px]"
              >
                Create
              </WinButton>
              <WinButton
                variant="secondary"
                onClick={() => setIsCreatingQueue(false)}
                className="min-w-[80px]"
              >
                Cancel
              </WinButton>
            </>
          }
        >
          <div className="space-y-2 py-1">
            <label className="text-[12px] text-neutral-600 font-medium">Queue Name:</label>
            <WinInput
              type="text"
              autoFocus
              value={newQueueName}
              onChange={(e) => setNewQueueName(e.target.value)}
              placeholder="e.g., Nightly Queue"
              className="w-full"
            />
          </div>
        </WindowsDialog>
      )}

      {msgBox && <MessageBoxDialog isOpen={Boolean(msgBox)} options={msgBox} onClose={() => setMsgBox(null)} />}
    </>
  );
};
