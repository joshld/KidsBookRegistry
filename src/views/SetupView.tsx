import { useState } from 'react';
import { BookOpen, Cloud, HardDrive, Loader2, Lock } from 'lucide-react';
import { useRegistry } from '../context/RegistryContext';
import { GoogleDriveAuthError } from '../lib/storage/providers/googleDrive';

type Step = 'provider' | 'passphrase' | 'unlock';

function formatDriveError(err: unknown): { message: string; details: string | null } {
  if (err instanceof GoogleDriveAuthError) {
    if (import.meta.env.DEV) {
      console.error('[Google Drive auth]', err.message, err.details);
    }
    return { message: err.message, details: err.details ?? null };
  }
  const message = err instanceof Error ? err.message : 'Failed to connect Google Drive';
  if (import.meta.env.DEV && err instanceof Error) {
    console.error('[Google Drive auth]', err);
  }
  return { message, details: null };
}

export default function SetupView() {
  const {
    bootPhase,
    connectDrive,
    connectLocal,
    unlock,
    setupPassphrase,
    syncStatus,
  } = useRegistry();

  const [step, setStep] = useState<Step>(bootPhase === 'unlock' ? 'unlock' : 'provider');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  async function handleConnectDrive() {
    setLoading(true);
    setError('');
    setErrorDetails(null);
    try {
      await connectDrive();
      setStep('unlock');
    } catch (err) {
      const formatted = formatDriveError(err);
      setError(formatted.message);
      setErrorDetails(formatted.details);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectLocal() {
    setLoading(true);
    setError('');
    try {
      await connectLocal();
      setStep('passphrase');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize local storage');
    } finally {
      setLoading(false);
    }
  }

  async function handlePassphraseSetup(e: React.FormEvent) {
    e.preventDefault();
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters');
      return;
    }
    if (passphrase !== confirm) {
      setError('Passphrases do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await setupPassphrase(passphrase, remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    setLoading(true);
    setError('');
    try {
      await unlock(passphrase, remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect passphrase or corrupted registry');
    } finally {
      setLoading(false);
    }
  }

  if (bootPhase === 'loading') {
    return (
      <div className="min-h-svh bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-indigo-100 dark:bg-indigo-900/50 p-2 rounded-xl">
            <BookOpen className="text-indigo-600 dark:text-indigo-400" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white leading-tight">
              KidsBookRegistry
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {step === 'provider' && 'Connect cloud storage'}
              {step === 'passphrase' && 'Create encryption passphrase'}
              {step === 'unlock' && 'Unlock your registry'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            <p className="font-medium">{error}</p>
            {errorDetails && (
              <p className="text-xs mt-2 text-red-600/90 dark:text-red-300/90 whitespace-pre-wrap break-words">
                {errorDetails}
              </p>
            )}
          </div>
        )}

        {step === 'provider' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Your registry is stored as one encrypted file in cloud storage. Google Drive is recommended.
            </p>
            {hasGoogleClientId ? (
              <button
                onClick={() => void handleConnectDrive()}
                disabled={loading}
                className="w-full flex items-center gap-3 bg-indigo-600 text-white rounded-xl px-4 py-3 text-sm font-medium hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 size={18} className="animate-spin" /> : <Cloud size={18} />}
                Connect Google Drive
              </button>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
                Set VITE_GOOGLE_CLIENT_ID to enable Google Drive. Using local storage for development.
              </p>
            )}
            <button
              onClick={() => void handleConnectLocal()}
              disabled={loading}
              className="w-full flex items-center gap-3 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl px-4 py-3 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all disabled:opacity-50"
            >
              <HardDrive size={18} />
              Use local storage (dev)
            </button>
          </div>
        )}

        {(step === 'passphrase' || step === 'unlock') && (
          <form
            onSubmit={(e) =>
              void (step === 'passphrase' ? handlePassphraseSetup(e) : handleUnlock(e))
            }
            className="space-y-4"
          >
            <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 rounded-xl px-3 py-2">
              <Lock size={14} className="shrink-0 mt-0.5" />
              <span>
                {step === 'passphrase'
                  ? 'This passphrase encrypts your registry. If you lose it, your data cannot be recovered.'
                  : 'Enter your passphrase to decrypt and load your registry.'}
              </span>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Passphrase
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                required
                minLength={step === 'passphrase' ? 8 : 1}
                className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {step === 'passphrase' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Confirm passphrase
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-slate-300"
              />
              Remember on this device
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-xl py-3 font-medium text-sm hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {step === 'passphrase' ? 'Create registry' : 'Unlock'}
            </button>

            {step === 'unlock' && (
              <button
                type="button"
                onClick={() => {
                  setStep('passphrase');
                  setPassphrase('');
                  setConfirm('');
                }}
                className="w-full text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                First time here? Create new registry
              </button>
            )}
          </form>
        )}

        {syncStatus.error && bootPhase === 'ready' && (
          <p className="mt-3 text-xs text-amber-600">{syncStatus.error}</p>
        )}
      </div>
    </div>
  );
}
