import type { SyncStatus } from '../lib/storage/registryService';

interface Props {
  status: SyncStatus;
  conflictMessage?: string | null;
  onResolveConflict?: (useRemote: boolean) => void;
  onSyncClaims: () => void;
}

export default function SyncBanner({
  status,
  conflictMessage,
  onResolveConflict,
  onSyncClaims,
}: Props) {
  if (
    status.state === 'idle' &&
    !status.error &&
    !status.pendingChanges &&
    !conflictMessage
  ) {
    return null;
  }

  if (conflictMessage && onResolveConflict) {
    return (
      <div className="bg-amber-800 text-amber-100 px-4 py-3 text-xs sticky top-0 z-50">
        <p className="text-center mb-2">{conflictMessage}</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => onResolveConflict(false)}
            className="bg-amber-900/50 px-3 py-1 rounded-lg hover:bg-amber-900"
          >
            Keep mine
          </button>
          <button
            onClick={() => onResolveConflict(true)}
            className="bg-amber-950/50 px-3 py-1 rounded-lg hover:bg-amber-950"
          >
            Use cloud copy
          </button>
        </div>
      </div>
    );
  }

  let bg = 'bg-slate-800';
  let text = 'text-slate-200';
  let icon = null;
  let message = '';

  if (status.state === 'saving' || status.state === 'loading') {
    bg = 'bg-indigo-700';
    text = 'text-indigo-100';
    icon = <span className="inline-block w-3 h-3 border-2 border-indigo-200 border-t-transparent rounded-full animate-spin" />;
    message = status.state === 'saving' ? 'Saving to cloud…' : 'Loading from cloud…';
  } else if (status.state === 'offline') {
    bg = 'bg-amber-700';
    text = 'text-amber-100';
    message = status.error ?? 'Offline — changes saved locally';
  } else if (status.state === 'error') {
    bg = 'bg-red-800';
    text = 'text-red-100';
    message = status.error ?? 'Sync error';
  } else if (status.pendingChanges) {
    bg = 'bg-slate-700';
    text = 'text-slate-200';
    message = 'Unsaved changes pending sync';
  }

  if (!message) return null;

  return (
    <div className={`${bg} ${text} px-4 py-2 text-xs flex items-center justify-center gap-2 sticky top-0 z-50`}>
      {icon}
      <span>{message}</span>
      {(status.state === 'idle' || status.state === 'offline') && (
        <button
          onClick={onSyncClaims}
          className="ml-2 underline hover:no-underline"
        >
          Sync claims
        </button>
      )}
    </div>
  );
}
