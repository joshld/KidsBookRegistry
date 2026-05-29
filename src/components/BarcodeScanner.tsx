import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, Search } from 'lucide-react';

interface Props {
  onScan: (isbn: string) => void;
}

const QR_ELEMENT_ID = 'kbr-qr-reader';

export default function BarcodeScanner({ onScan }: Props) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const initializedRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  const [manualIsbn, setManualIsbn] = useState('');
  const [manualError, setManualError] = useState('');
  const hasScanned = useRef(false);

  useEffect(() => {
    // Guard against StrictMode double-mount or rapid re-renders
    if (initializedRef.current) return;
    initializedRef.current = true;

    const scanner = new Html5Qrcode(QR_ELEMENT_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 100 } },
        (decodedText) => {
          if (hasScanned.current) return;
          hasScanned.current = true;
          const digits = decodedText.replace(/\D/g, '');
          if (digits.length === 13 || digits.length === 10) {
            // Stop scanner before firing callback so cleanup is a no-op
            scanner.stop().catch(() => {}).finally(() => onScan(digits));
          }
        },
        () => {
          // per-frame decode failure — ignore
        },
      )
      .then(() => setIsStarting(false))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Camera unavailable';
        setCameraError(msg);
        setIsStarting(false);
      });

    return () => {
      // Wrap in try/catch — html5-qrcode can throw synchronously if already stopped
      try {
        scanner.stop().catch(() => {});
      } catch {
        // ignore
      }
    };
  // onScan is stable via useCallback in AddBookModal — intentionally omitted
  // from deps to prevent restarting the camera on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleManualLookup(e: React.FormEvent) {
    e.preventDefault();
    const digits = manualIsbn.replace(/\D/g, '');
    if (digits.length !== 13 && digits.length !== 10) {
      setManualError('Please enter a valid 10 or 13-digit ISBN.');
      return;
    }
    setManualError('');
    // Stop camera if running
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
    }
    onScan(digits);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Camera area */}
      {!cameraError ? (
        <div className="rounded-xl overflow-hidden bg-black">
          <div id={QR_ELEMENT_ID} className="w-full" />

          {isStarting && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
              <div className="text-center text-white/70 text-sm">
                <Camera size={28} className="mx-auto mb-2 animate-pulse" />
                Starting camera…
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 p-6 text-center text-slate-500 dark:text-slate-400">
          <CameraOff size={28} className="mx-auto mb-2 text-slate-400 dark:text-slate-500" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Camera unavailable</p>
          <p className="text-xs mt-1">{cameraError}</p>
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs">
        <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
        <span>or enter ISBN manually</span>
        <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
      </div>

      {/* Manual input */}
      <form onSubmit={handleManualLookup} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9\-\s]*"
            maxLength={17}
            value={manualIsbn}
            onChange={(e) => {
              setManualIsbn(e.target.value);
              setManualError('');
            }}
            placeholder="978…"
            className="flex-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
          <button
            type="submit"
            className="bg-indigo-600 text-white rounded-xl px-4 py-3 flex items-center gap-1.5 text-sm font-medium hover:bg-indigo-700 active:scale-95 transition-all whitespace-nowrap"
          >
            <Search size={16} />
            Look up
          </button>
        </div>
        {manualError && (
          <p className="text-xs text-red-500">{manualError}</p>
        )}
      </form>
    </div>
  );
}
