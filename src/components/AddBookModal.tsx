import { useState, useCallback, type Dispatch } from 'react';
import { X, BookOpen, Loader2, AlertTriangle } from 'lucide-react';
import type { Book, Child, Action, ListType } from '../types';
import { mockLookup } from '../lib/mockLookup';
import { lookupIsbn } from '../lib/isbnLookup';
import { crypto } from '../lib/uid';
import BarcodeScanner from './BarcodeScanner';

type Step = 'scan' | 'loading' | 'confirm';

interface DuplicateWarning {
  sameChild: boolean;
  childName: string;
  status: string;
  claimedBy?: string;
}

interface Props {
  childId: string;
  listType: ListType;
  books: Book[];
  children: Child[];
  dispatch: Dispatch<Action>;
  onClose: () => void;
}

export default function AddBookModal({ childId, listType, books, children, dispatch, onClose }: Props) {
  const [step, setStep] = useState<Step>('scan');
  const [scannedIsbn, setScannedIsbn] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);

  const handleScan = useCallback(async (isbn: string) => {
    setScannedIsbn(isbn);
    setStep('loading');
    const matches = books.filter((b) => b.isbn === isbn);
    setDuplicates(matches.map((b) => {
      const child = children.find((c) => c.id === b.childId);
      return { sameChild: b.childId === childId, childName: child?.name ?? 'Unknown', status: b.status, claimedBy: b.claimedBy };
    }));
    try {
      const meta = await lookupIsbn(isbn);
      const fallback = mockLookup(isbn);
      setTitle(meta.title || fallback.title);
      setAuthor(meta.author || fallback.author);
      setImageUrl(meta.imageUrl || fallback.imageUrl);
    } catch {
      const fallback = mockLookup(isbn);
      setTitle(fallback.title); setAuthor(fallback.author); setImageUrl(fallback.imageUrl);
    }
    setStep('confirm');
  }, [books, children, childId]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    dispatch({ type: 'ADD_BOOK', book: { id: crypto(), childId, isbn: scannedIsbn, title: title.trim(), author: author.trim(), imageUrl: imageUrl.trim(), listType, status: 'Available' } });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-30 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm mb-2 overflow-hidden max-h-[90svh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {step === 'scan' ? (listType === 'owned' ? 'Add to library' : 'Add to wish list') : step === 'loading' ? 'Looking up book…' : 'Confirm book details'}
          </h3>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 active:opacity-60 p-1 -mr-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          {step === 'scan' && <BarcodeScanner onScan={handleScan} />}

          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500 dark:text-slate-400">
              <Loader2 size={32} className="animate-spin text-indigo-500" />
              <p className="text-sm">Looking up ISBN {scannedIsbn}…</p>
            </div>
          )}

          {step === 'confirm' && (
            <form onSubmit={handleSave} className="space-y-4">
              {duplicates.length > 0 && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium text-xs">
                    <AlertTriangle size={13} />
                    Already on a registry
                  </div>
                  {duplicates.map((d, i) => (
                    <p key={i} className="text-xs text-amber-700 dark:text-amber-400">
                      {d.sameChild ? 'This child' : d.childName}{' · '}{d.status === 'Claimed' ? `Claimed${d.claimedBy ? ` by ${d.claimedBy}` : ''}` : 'Available'}
                    </p>
                  ))}
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">You can still save a second copy if needed.</p>
                </div>
              )}

              <div className="flex justify-center">
                {imageUrl ? (
                  <img src={imageUrl} alt={title} className="w-16 h-24 object-cover rounded-lg shadow-sm" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="w-16 h-24 bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center">
                    <BookOpen size={24} className="text-slate-400 dark:text-slate-500" />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">ISBN</label>
                <p className="text-sm font-mono text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2">{scannedIsbn}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Title <span className="text-red-400">*</span></label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Author</label>
                <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Cover image URL</label>
                <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setStep('scan')} className="flex-1 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl py-3 text-sm font-medium">Back</button>
                <button type="submit" className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-indigo-700 active:scale-95 transition-all">Save book</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
