import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BookOpen, Gift, Loader2 } from 'lucide-react';
import type { Book, BookStatus, ListType, Action } from '../types';
import BookCard from '../components/BookCard';
import ClaimModal from '../components/ClaimModal';
import { registryService } from '../lib/storage/registryService';
import type { PublicBookSlice } from '../lib/storage/types';

function toGuestBook(slice: PublicBookSlice, childId: string): Book {
  return {
    id: slice.id,
    childId,
    isbn: slice.isbn,
    title: slice.title,
    author: slice.author,
    imageUrl: slice.imageUrl,
    listType: 'wishlist' as ListType,
    status: slice.status as BookStatus,
    claimedBy: slice.claimedBy,
  };
}

export default function PublicGuestView() {
  const { childId } = useParams<{ childId: string }>();
  const [searchParams] = useSearchParams();
  const fileId = searchParams.get('f') ?? '';
  const shareKey = window.location.hash.replace(/^#/, '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [childName, setChildName] = useState('');
  const [books, setBooks] = useState<Book[]>([]);
  const [claimingBook, setClaimingBook] = useState<Book | null>(null);
  const [claimError, setClaimError] = useState('');

  const loadWishlist = useCallback(async () => {
    if (!childId || !shareKey) {
      setError('Invalid share link — missing encryption key.');
      setLoading(false);
      return;
    }
    if (!fileId) {
      setError('Invalid share link — missing cloud file reference.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const slice = await registryService.loadGuestWishlist(fileId, childId, shareKey);
      if (!slice) {
        setError('Could not load wish list. The link may be expired or invalid.');
        setBooks([]);
        return;
      }
      setChildName(slice.childName);
      setBooks(slice.books.map((b) => toGuestBook(b, childId)));
    } catch {
      setError('Failed to load wish list from cloud storage.');
    } finally {
      setLoading(false);
    }
  }, [childId, fileId, shareKey]);

  useEffect(() => {
    void loadWishlist();
  }, [loadWishlist]);

  async function handleClaim(bookId: string, claimedBy: string) {
    if (!childId || !fileId || !shareKey) return;
    setClaimError('');
    try {
      await registryService.submitGuestClaim(fileId, childId, shareKey, bookId, claimedBy);
      await loadWishlist();
      setClaimingBook(null);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Claim failed');
    }
  }

  const guestDispatch = useCallback(
    (action: Action) => {
      if (action.type === 'CLAIM_BOOK') {
        void handleClaim(action.bookId, action.claimedBy);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [childId, fileId, shareKey],
  );

  if (loading) {
    return (
      <div className="min-h-svh bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  if (error || !childId) {
    return (
      <div className="min-h-svh bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center text-slate-500 dark:text-slate-400">
          <BookOpen size={36} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium text-slate-700 dark:text-slate-300">Registry not found</p>
          <p className="text-sm mt-1">{error || 'This link may be invalid.'}</p>
        </div>
      </div>
    );
  }

  const available = books.filter((b) => b.status === 'Available');
  const claimed = books.filter((b) => b.status === 'Claimed');

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-5">
        <div className="max-w-lg mx-auto text-center">
          <div className="bg-indigo-100 dark:bg-indigo-900/50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-indigo-700 dark:text-indigo-400 text-lg font-bold">
              {childName[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{childName}'s Wish List</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-center gap-1">
            <Gift size={14} />
            Pick a book to buy as a gift
          </p>
        </div>
      </header>

      {claimError && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">
            {claimError}
          </p>
        </div>
      )}

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
        <ClaimModal
          book={claimingBook}
          dispatch={guestDispatch}
          onClose={() => setClaimingBook(null)}
        />
      )}
    </div>
  );
}
