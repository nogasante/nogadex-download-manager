import React, { useEffect, useState } from 'react';
import { WindowsDialog } from './common/WindowsDialog';
import { WinButton, WinCheckbox } from './common/WinControls';

interface ClearListConfirmDialogProps {
  isOpen: boolean;
  count: number;
  /** Which list is being cleared — shown in the message. */
  listName: 'Unfinished' | 'Finished';
  onConfirm: (deleteFiles: boolean) => void;
  onCancel: () => void;
}

/**
 * Confirmation before a sidebar "Clear list" action. Hosts a tick-box for
 * also deleting the downloaded files from disk (rows-only removal is the
 * default), which the plain MessageBoxDialog cannot express.
 */
export const ClearListConfirmDialog: React.FC<ClearListConfirmDialogProps> = ({
  isOpen,
  count,
  listName,
  onConfirm,
  onCancel,
}) => {
  const [deleteFiles, setDeleteFiles] = useState(false);

  // Reset the tick-box every time the dialog opens — never carry a previous
  // destructive choice over to the next confirmation.
  useEffect(() => {
    if (isOpen) setDeleteFiles(false);
  }, [isOpen]);

  return (
    <WindowsDialog
      isOpen={isOpen}
      onClose={onCancel}
      title="Confirm Clear List"
      width="w-[460px]"
      footer={
        <div className="w-full flex items-center justify-end gap-2">
          <WinButton variant="danger" onClick={() => onConfirm(deleteFiles)} className="min-w-[84px]">
            Clear
          </WinButton>
          <WinButton variant="secondary" onClick={onCancel} className="min-w-[84px]">
            Cancel
          </WinButton>
        </div>
      }
    >
      <div className="space-y-3 font-sans text-[12px]">
        <p className="text-neutral-800 leading-relaxed select-text">
          Remove {count} {count === 1 ? 'item' : 'items'} from the {listName} list?
        </p>
        <WinCheckbox
          checked={deleteFiles}
          onChange={setDeleteFiles}
          label="Also delete the downloaded files from disk"
        />
        <p className="text-[11px] text-neutral-500">
          {deleteFiles
            ? 'The files will be permanently deleted from your computer.'
            : 'The downloaded files will remain on disk unless you tick the box above.'}
        </p>
      </div>
    </WindowsDialog>
  );
};
