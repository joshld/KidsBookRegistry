import { useState, type Dispatch } from 'react';
import { BookOpen, CheckCircle, Library, Trash2, Undo2 } from 'lucide-react';
import type { Book, Action } from '../types';

interface Props {
  book: Book;
  dispatch?: Dispatch<Action>;
  onClaim?: () => void;
}

export default function BookCard({ book, dispatch, onClaim }: Props) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  function handleRemove() {
    dispatch?.({ type: 'REMOVE_BOOK', bookId: book.id });
  }

  function handleUnclaim() {
    dispatch?.({ type: 'UNCLAIM_BOOK', bookId: book.id });
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="flex gap-3 p-4 items-start">
        {/* Cover */}
        <div className="shrink-0 w-12 h-16 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
          {book.imageUrl ? (
            <img
              src={book.imageUrl}
              alt={book.title}
              className="w-full h-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <BookOpen size={20} className="text-slate-400 dark:text-slate-500" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-900 dark:text-white text-sm leading-snug truncate">{book.title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{book.author}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-mono">{book.isbn}</p>

          {/* Owned badge */}
          {book.listType === 'owned' && (
            <span className="inline-flex items-center gap-1 mt-1.5 text-xs text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-full px-2 py-0.5">
              <Library size={10} />
              Owned
            </span>
          )}

          {/* Wishlist — claimed */}
          {book.listType === 'wishlist' && book.status === 'Claimed' && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-full px-2 py-0.5">
                <CheckCircle size={11} />
                Being bought{book.claimedBy ? ` by ${book.claimedBy}` : ''}
              </span>
              {dispatch && (
                <button
                  onClick={handleUnclaim}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 active:opacity-60 transition-colors"
                  title="Undo claim"
                >
                  <Undo2 size={12} />
                  Unclaim
                </button>
              )}
            </div>
          )}

          {/* Wishlist — available (owner view) */}
          {book.listType === 'wishlist' && book.status === 'Available' && !onClaim && (
            <span className="inline-flex items-center gap-1 mt-1.5 text-xs text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-full px-2 py-0.5">
              Wanted
            </span>
          )}

          {/* Guest claim button */}
          {onClaim && book.listType === 'wishlist' && book.status === 'Available' && (
            <button
              onClick={onClaim}
              className="mt-2 w-full bg-indigo-600 text-white text-xs font-medium rounded-xl py-2 hover:bg-indigo-700 active:scale-95 transition-all"
            >
              I'll buy this!
            </button>
          )}
        </div>

        {/* Remove button */}
        {dispatch && !confirmRemove && (
          <button
            onClick={() => setConfirmRemove(true)}
            className="shrink-0 text-slate-300 dark:text-slate-600 hover:text-red-400 dark:hover:text-red-400 active:opacity-60 transition-colors p-1 -mt-1 -mr-1"
            aria-label="Remove book"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Inline remove confirmation */}
      {confirmRemove && (
        <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 flex items-center justify-between bg-red-50 dark:bg-red-900/20">
          <p className="text-xs text-red-700 dark:text-red-400 font-medium">Remove this book?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmRemove(false)}
              className="text-xs text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={handleRemove}
              className="text-xs text-white bg-red-500 rounded-lg px-3 py-1.5 hover:bg-red-600 active:scale-95 transition-all"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
