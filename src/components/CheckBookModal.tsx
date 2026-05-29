import { useState, useCallback, type Dispatch } from 'react';
import { X, BookOpen, CheckCircle, Loader2, Gift } from 'lucide-react';
import type { Book, Child, Action } from '../types';
import { lookupIsbn } from '../lib/isbnLookup';
import { mockLookup } from '../lib/mockLookup';
import type { BookMeta } from '../lib/mockLookup';
import BarcodeScanner from './BarcodeScanner';
import ClaimModal from './ClaimModal';

type Step = 'scan' | 'loading' | 'result';

interface RegistryMatch {
  book: Book;
  childName: string;
}

interface Props {
  books: Book[];
  children: Child[];
  dispatch: Dispatch<Action>;
  onClose: () => void;
}

export default function CheckBookModal({ books, children, dispatch, onClose }: Props) {
  const [step, setStep] = useState<Step>('scan');
  const [isbn, setIsbn] = useState('');
  const [meta, setMeta] = useState<BookMeta | null>(null);
  const [matches, setMatches] = useState<RegistryMatch[]>([]);
  const [claimingBook, setClaimingBook] = useState<Book | null>(null);

  const handleScan = useCallback(async (scanned: string) => {
    setIsbn(scanned);
    setStep('loading');

    const found = books
      .filter((b) => b.isbn === scanned)
      .map((b) => ({
        book: b,
        childName: children.find((c) => c.id === b.childId)?.name ?? 'Unknown',
      }));
    setMatches(found);

    try {
      const result = await lookupIsbn(scanned);
      const fallback = mockLookup(scanned);
      setMeta({
        title: result.title || fallback.title,
        author: result.author || fallback.author,
        imageUrl: result.imageUrl || fallback.imageUrl,
      });
    } catch {
      setMeta(mockLookup(scanned));
    }

    setStep('result');
  }, [books, children]);

  function handleRescan() {
    setStep('scan');
    setIsbn('');
    setMeta(null);
    setMatches([]);
  }

  // After a claim, refresh the match list from the latest books prop
  function handleClaimClose() {
    setClaimingBook(null);
    // Re-derive matches so the UI immediately reflects the claimed status
    const refreshed = books
      .filter((b) => b.isbn === isbn)
      .map((b) => ({
        book: b,
        childName: children.find((c) => c.id === b.childId)?.name ?? 'Unknown',
      }));
    setMatches(refreshed);
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 flex items-end justify-center z-30 p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm mb-2 overflow-hidden max-h-[90svh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              {step === 'scan' ? 'Check a book' : step === 'loading' ? 'Checking…' : 'Registry status'}
            </h3>
            <button
              onClick={onClose}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 active:opacity-60 p-1 -mr-1"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-4">
            {step === 'scan' && (
              <>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                  Scan a book's barcode to see if it's on any registry and whether it's been claimed.
                </p>
                <BarcodeScanner onScan={handleScan} />
              </>
            )}

            {step === 'loading' && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500 dark:text-slate-400">
                <Loader2 size={32} className="animate-spin text-indigo-500" />
                <p className="text-sm">Checking registries…</p>
              </div>
            )}

            {step === 'result' && meta && (
              <div className="space-y-4">
                {/* Book identity */}
                <div className="flex gap-3 items-start">
                  <div className="shrink-0 w-12 h-16 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    {meta.imageUrl ? (
                      <img
                        src={meta.imageUrl}
                        alt={meta.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <BookOpen size={20} className="text-slate-400 dark:text-slate-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white text-sm leading-snug">
                      {meta.title || 'Unknown Book'}
                    </p>
                    {meta.author && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{meta.author}</p>
                    )}
                    <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5">{isbn}</p>
                  </div>
                </div>

                {/* Registry results */}
                {matches.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 px-4 py-4 text-center">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Not on any registry</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      This book hasn't been added to any child's wish list yet.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      Found on {matches.length} {matches.length === 1 ? 'registry' : 'registries'}
                    </p>
                    {matches.map(({ book, childName }) => {
                      const isOwned = book.listType === 'owned';
                      const isClaimed = book.status === 'Claimed';
                      const isClaimable = !isOwned && !isClaimed;

                      let containerStyle: string;
                      if (isOwned) containerStyle = 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20';
                      else if (isClaimed) containerStyle = 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20';
                      else containerStyle = 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20';

                      let iconBg: string;
                      if (isOwned) iconBg = 'bg-amber-100 dark:bg-amber-900/50';
                      else if (isClaimed) iconBg = 'bg-emerald-100 dark:bg-emerald-900/50';
                      else iconBg = 'bg-indigo-100 dark:bg-indigo-900/50';

                      return (
                        <div
                          key={book.id}
                          className={`rounded-xl border overflow-hidden ${containerStyle}`}
                        >
                          <div className="px-4 py-3 flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
                              {isClaimed && !isOwned ? (
                                <CheckCircle size={16} className="text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <span className={`font-semibold text-xs ${isOwned ? 'text-amber-700 dark:text-amber-400' : 'text-indigo-700 dark:text-indigo-400'}`}>
                                  {childName[0].toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{childName}</p>
                              {isOwned ? (
                                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Already owns this book</p>
                              ) : isClaimed ? (
                                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                                  Already being bought{book.claimedBy ? ` by ${book.claimedBy}` : ''}
                                </p>
                              ) : (
                                <p className="text-xs text-indigo-700 dark:text-indigo-400">On wish list — safe to buy!</p>
                              )}
                            </div>
                          </div>

                          {isClaimable && (
                            <div className="px-4 pb-3">
                              <button
                                onClick={() => setClaimingBook(book)}
                                className="w-full bg-indigo-600 text-white text-xs font-medium rounded-xl py-2.5 flex items-center justify-center gap-1.5 hover:bg-indigo-700 active:scale-95 transition-all"
                              >
                                <Gift size={13} />
                                I'll buy this for {childName}!
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  onClick={handleRescan}
                  className="w-full border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl py-3 text-sm font-medium"
                >
                  Check another book
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Claim modal sits above the check modal */}
      {claimingBook && (
        <ClaimModal
          book={claimingBook}
          dispatch={dispatch}
          onClose={handleClaimClose}
        />
      )}
    </>
  );
}
