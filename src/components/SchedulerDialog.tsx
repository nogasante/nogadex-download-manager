import React, { useState } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { MessageBoxDialog, MessageBoxOptions } from './MessageBoxDialog';
import { WinCheckbox, WinRadio, WinInput, WinSelect, WinButton, WinGroupBox, WinTabs } from './common/WinControls';

interface SchedulerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onStartQueue?: () => void;
  onStopQueue?: () => void;
}

export const SchedulerDialog: React.FC<SchedulerDialogProps> = ({
  isOpen,
  onClose,
  onStartQueue,
  onStopQueue,
}) => {
  const [activeTab, setActiveTab] = useState<'schedule' | 'files'>('schedule');
  const [scheduleType, setScheduleType] = useState<'periodic' | 'onetime'>('periodic');
  const [days, setDays] = useState({ Sun: true, Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: true });
  const [enableStart, setEnableStart] = useState(false);
  const [startTime, setStartTime] = useState('23:00');
  const [enableStop, setEnableStop] = useState(false);
  const [stopTime, setStopTime] = useState('07:30');
  const [simultaneousDownloads, setSimultaneousDownloads] = useState(1);
  const [retries, setRetries] = useState(5);
  const [exitOnComplete, setExitOnComplete] = useState(false);
  const [shutdownOnComplete, setShutdownOnComplete] = useState(false);
  const [isQueueActive, setIsQueueActive] = useState(false);
  const [msgBox, setMsgBox] = useState<MessageBoxOptions | null>(null);

  const toggleDay = (day: keyof typeof days) => {
    setDays((prev) => ({ ...prev, [day]: !prev[day] }));
  };

  const handleStartQueue = () => {
    if (onStartQueue) onStartQueue();
    setIsQueueActive(true);
    setMsgBox({
      title: 'Nogadex Download Manager',
      type: 'info',
      message: 'Queue scheduler activated. Downloads will proceed according to your schedule profile.',
    });
  };

  const handleStopQueue = () => {
    if (onStopQueue) onStopQueue();
    setIsQueueActive(false);
  };

  const footer = (
    <div className="w-full flex items-center justify-between">
      <div className="flex items-center gap-2">
        <WinButton
          variant="primary"
          onClick={handleStartQueue}
          disabled={isQueueActive}
          className="min-w-[110px]"
        >
          {isQueueActive ? 'Queue Running' : 'Start Queue Now'}
        </WinButton>
        <WinButton
          variant="secondary"
          onClick={handleStopQueue}
          disabled={!isQueueActive}
          className="min-w-[70px]"
        >
          Stop
        </WinButton>
      </div>
      <WinButton variant="secondary" onClick={onClose} className="min-w-[84px]">
        Close
      </WinButton>
    </div>
  );

  const tabs = [
    { id: 'schedule', label: 'Schedule Settings' },
    { id: 'files', label: 'Files in Queue (0)' },
  ];

  return (
    <>
      <WindowsDialog
        isOpen={isOpen}
        onClose={onClose}
        title="Download Queue & Scheduler"
        width="w-[660px]"
        footer={footer}
      >
        <div className="grid grid-cols-3 gap-3 min-h-[300px]">
          {/* Left Queues List */}
          <div className="col-span-1 border border-[#cbd5e1] bg-[#fafafa] p-2 flex flex-col justify-between rounded-[2px]">
            <div className="space-y-1">
              <div className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider mb-1">
                Download Queues
              </div>
              <button
                type="button"
                className="w-full text-left px-2 py-1 bg-[#cde8ff] border border-[#70baff] text-[#005a9e] rounded-[2px] font-semibold text-[11.5px]"
              >
                Default Queue
              </button>
            </div>
            <div className="flex gap-1 pt-2">
              <button
                type="button"
                className="flex-1 h-[24px] bg-white border border-[#cbd5e1] hover:bg-[#f1f5f9] rounded-[2px] text-[11px]"
              >
                + New Queue
              </button>
              <button
                type="button"
                disabled
                className="px-2 h-[24px] bg-white border border-[#cbd5e1] text-[#dc2626] opacity-50 rounded-[2px] text-[11px]"
              >
                Delete
              </button>
            </div>
          </div>

          {/* Right Queue Settings */}
          <div className="col-span-2 space-y-3">
            <WinTabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as any)} />

            {activeTab === 'schedule' ? (
              <div className="space-y-3">
                <WinGroupBox title="Timing & Execution Profile" className="space-y-3">
                  <div className="flex items-center gap-4 text-[12px]">
                    <WinRadio
                      checked={scheduleType === 'periodic'}
                      onChange={() => setScheduleType('periodic')}
                      label="Periodic schedule"
                    />
                    <WinRadio
                      checked={scheduleType === 'onetime'}
                      onChange={() => setScheduleType('onetime')}
                      label="One-time downloading"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[#64748b] text-[11px] font-semibold">Active Schedule Days:</label>
                    <div className="flex gap-1">
                      {(Object.keys(days) as (keyof typeof days)[]).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleDay(d)}
                          className={`flex-1 h-[24px] text-[11px] font-medium rounded-[2px] transition-colors ${
                            days[d] ? 'bg-[#005a9e] text-white' : 'bg-[#f1f5f9] text-[#64748b] border border-[#cbd5e1]'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <WinCheckbox
                        checked={enableStart}
                        onChange={setEnableStart}
                        label="Start at:"
                      />
                      <WinInput
                        type="time"
                        disabled={!enableStart}
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="h-[24px] text-[11px] w-24"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <WinCheckbox
                        checked={enableStop}
                        onChange={setEnableStop}
                        label="Stop at:"
                      />
                      <WinInput
                        type="time"
                        disabled={!enableStop}
                        value={stopTime}
                        onChange={(e) => setStopTime(e.target.value)}
                        className="h-[24px] text-[11px] w-24"
                      />
                    </div>
                  </div>
                </WinGroupBox>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[#475569] text-[11px]">Simultaneous downloads in queue:</label>
                    <WinSelect
                      value={simultaneousDownloads}
                      onChange={(e) => setSimultaneousDownloads(Number(e.target.value))}
                      className="w-full"
                    >
                      <option value={1}>1 file</option>
                      <option value={2}>2 files</option>
                      <option value={3}>3 files</option>
                    </WinSelect>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[#475569] text-[11px]">Number of retries for failed downloads:</label>
                    <WinInput
                      type="number"
                      min="1"
                      max="20"
                      value={retries}
                      onChange={(e) => setRetries(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <WinCheckbox
                    checked={exitOnComplete}
                    onChange={setExitOnComplete}
                    label="Exit Nogadex Download Manager when queue completes"
                  />
                  <div />
                  <WinCheckbox
                    checked={shutdownOnComplete}
                    onChange={setShutdownOnComplete}
                    label="Turn off computer when downloads finish"
                  />
                </div>
              </div>
            ) : (
              <div className="h-44 border border-[#cbd5e1] bg-[#fafafa] flex items-center justify-center text-[#94a3b8] italic text-[11px]">
                No files in this queue. Add downloads with "Add to Queue".
              </div>
            )}
          </div>
        </div>
      </WindowsDialog>

      {msgBox && <MessageBoxDialog isOpen={Boolean(msgBox)} options={msgBox} onClose={() => setMsgBox(null)} />}
    </>
  );
};
