import { useState, type Dispatch } from 'react';
import { useParams } from 'react-router-dom';
import { BookOpen, Gift } from 'lucide-react';
import type { Book, Action } from '../types';
import { loadState } from '../lib/storage';
import BookCard from '../components/BookCard';
import ClaimModal from '../components/ClaimModal';

interface Props {
  dispatch: Dispatch<Action>;
}

export default function PublicGuestView({ dispatch }: Props) {
  const { childId } = useParams<{ childId: string }>();
  const [claimingBook, setClaimingBook] = useState<Book | null>(null);

  const state = loadState();
  const child = state.children.find((c) => c.id === childId);
  const books = state.books.filter((b) => b.childId === childId && b.listType === 'wishlist');
  const available = books.filter((b) => b.status === 'Available');
  const claimed = books.filter((b) => b.status === 'Claimed');

  if (!child) {
    return (
      <div className="min-h-svh bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center text-slate-500 dark:text-slate-400">
          <BookOpen size={36} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium text-slate-700 dark:text-slate-300">Registry not found</p>
          <p className="text-sm mt-1">This link may be invalid or the registry no longer exists.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-5">
        <div className="max-w-lg mx-auto text-center">
          <div className="bg-indigo-100 dark:bg-indigo-900/50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-indigo-700 dark:text-indigo-400 text-lg font-bold">{child.name[0].toUpperCase()}</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{child.name}'s Wish List</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-center gap-1">
            <Gift size={14} />
            Pick a book to buy as a gift
          </p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 pb-12 space-y-6">
        {books.length === 0 ? (
          <div className="text-center py-14 text-slate-400 dark:text-slate-500">
            <BookOpen size={36} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">No books on the list yet.</p>
          </div>
        ) : (
          <>
            {available.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                  Still needed ({available.length})
                </h2>
                <div className="space-y-3">
                  {available.map((book) => (
                    <BookCard key={book.id} book={book} onClaim={() => setClaimingBook(book)} />
                  ))}
                </div>
              </section>
            )}
            {claimed.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                  Already claimed ({claimed.length})
                </h2>
                <div className="space-y-3">
                  {claimed.map((book) => (
                    <BookCard key={book.id} book={book} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {claimingBook && (
        <ClaimModal book={claimingBook} dispatch={dispatch} onClose={() => setClaimingBook(null)} />
      )}
    </div>
  );
}
