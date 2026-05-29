import { useState, type Dispatch } from 'react';
import { X, Gift } from 'lucide-react';
import type { Book, Action } from '../types';

interface Props {
  book: Book;
  dispatch: Dispatch<Action>;
  onClose: () => void;
}

export default function ClaimModal({ book, dispatch, onClose }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter your name.'); return; }
    dispatch({ type: 'CLAIM_BOOK', bookId: book.id, claimedBy: name.trim() });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-30 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm mb-2 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Gift size={18} className="text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">I'll buy this!</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 active:opacity-60 p-1 -mr-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Claiming <strong className="text-slate-900 dark:text-white">{book.title}</strong>.
          Enter your name so the family knows who's buying it.
        </p>

        <form onSubmit={handleClaim} className="space-y-4">
          <div>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="Your name (e.g. Aunt Sarah)"
              autoFocus
              className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
          <button type="submit" className="w-full bg-indigo-600 text-white rounded-xl py-3 font-medium text-sm hover:bg-indigo-700 active:scale-95 transition-all">
            Confirm claim
          </button>
        </form>
      </div>
    </div>
  );
}
