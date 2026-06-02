import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BookOpen, Gift, Loader2, ScanSearch } from 'lucide-react';
import type { Book, BookStatus, ListType, Action, Child } from '../types';
import BookCard from '../components/BookCard';
import ClaimModal from '../components/ClaimModal';
import CheckBookModal from '../components/CheckBookModal';
import { registryService } from '../lib/storage/registryService';
import type { PublicBookSlice, PublicOwnedBookSlice } from '../lib/storage/types';
import {
  canGuestUnclaim,
  getGuestClaimedBookIds,
  recordGuestClaim,
  removeGuestClaimRecord,
} from '../lib/guestClaimSession';

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

function toOwnedGuestBook(slice: PublicOwnedBookSlice, childId: string): Book {
  return {
    id: `owned-${slice.isbn}`,
    childId,
    isbn: slice.isbn,
    title: slice.title,
    author: slice.author,
    imageUrl: slice.imageUrl,
    listType: 'owned',
    status: 'Available',
  };
}

export default function PublicGuestView() {
  const { childId } = useParams<{ childId: string }>();
  const [searchParams] = useSearchParams();
  const fileId = searchParams.get('f') ?? '';
  const shareKey =
    window.location.hash.replace(/^#/, '') || searchParams.get('k') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [childName, setChildName] = useState('');
  const [wishlistBooks, setWishlistBooks] = useState<Book[]>([]);
  const [ownedBooks, setOwnedBooks] = useState<Book[]>([]);
  const [claimingBook, setClaimingBook] = useState<Book | null>(null);
  const [claimError, setClaimError] = useState('');
  const [showCheckBook, setShowCheckBook] = useState(false);

  const checkBooks = useMemo(
    () => [...wishlistBooks, ...ownedBooks],
    [wishlistBooks, ownedBooks],
  );

  const guestChild = useMemo((): Child[] => {
    if (!childId) return [];
    return [{ id: childId, name: childName, profileId: 'guest' }];
  }, [childId, childName]);

  const loadWishlist = useCallback(async () => {
    if (!childId || !shareKey) {
      setError('Invalid share link — missing encryption key. Ask for the full link (including the # part at the end).');
      setLoading(false);
      return;
    }
    if (!fileId) {
      setError('Invalid share link — missing cloud file reference (?f=).');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const slice = await registryService.loadGuestWishlist(fileId, childId, shareKey);
      if (!slice.ok) {
        setError(slice.message);
        setWishlistBooks([]);
        setOwnedBooks([]);
        return;
      }
      setChildName(slice.childName);
      setWishlistBooks(slice.books.map((b) => toGuestBook(b, childId)));
      setOwnedBooks(slice.ownedBooks.map((b) => toOwnedGuestBook(b, childId)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load wish list: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [childId, fileId, shareKey]);

  useEffect(() => {
    void loadWishlist();
  }, [loadWishlist]);

  async function handleClaim(bookId: string, claimedBy: string, scannedBook?: Book) {
    if (!childId || !fileId || !shareKey) return;
    setClaimError('');
    try {
      const onList = wishlistBooks.some((b) => b.id === bookId);
      const result = await registryService.submitGuestClaim(
        fileId,
        childId,
        shareKey,
        bookId,
        claimedBy,
        scannedBook && !onList
          ? {
              id: scannedBook.id,
              isbn: scannedBook.isbn,
              title: scannedBook.title,
              author: scannedBook.author,
              imageUrl: scannedBook.imageUrl,
            }
          : undefined,
      );
      if (result.ok) {
        recordGuestClaim(fileId, childId, bookId);
        setChildName(result.childName);
        setWishlistBooks(result.books.map((b) => toGuestBook(b, childId)));
        setOwnedBooks(result.ownedBooks.map((b) => toOwnedGuestBook(b, childId)));
      }
      setClaimingBook(null);
      setShowCheckBook(false);
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Claim failed');
    }
  }

  async function handleGuestUnclaim(bookId: string) {
    if (!childId || !fileId || !shareKey || !canGuestUnclaim(fileId, childId, bookId)) return;
    setClaimError('');
    try {
      const result = await registryService.submitGuestUnclaim(fileId, childId, shareKey, bookId);
      if (result.ok) {
        removeGuestClaimRecord(fileId, childId, bookId);
        setChildName(result.childName);
        setWishlistBooks(result.books.map((b) => toGuestBook(b, childId)));
        setOwnedBooks(result.ownedBooks.map((b) => toOwnedGuestBook(b, childId)));
      }
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Could not undo claim');
    }
  }

  const handleGuestClaim = useCallback(
    (book: Book, claimedBy: string) => {
      void handleClaim(book.id, claimedBy, book);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [childId, fileId, shareKey, wishlistBooks],
  );

  const guestDispatch = useCallback(
    (action: Action) => {
      if (action.type === 'CLAIM_BOOK') {
        void handleClaim(action.bookId, action.claimedBy);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [childId, fileId, shareKey],
  );

  const guestClaimedIds = useMemo(
    () => (childId && fileId ? new Set(getGuestClaimedBookIds(fileId, childId)) : new Set<string>()),
    [fileId, childId, wishlistBooks],
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

  const available = wishlistBooks.filter((b) => b.status === 'Available');
  const claimed = wishlistBooks.filter((b) => b.status === 'Claimed');

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
        <button
          onClick={() => setShowCheckBook(true)}
          className="w-full rounded-2xl px-4 py-4 flex items-center gap-3 text-left transition-all bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:scale-95"
        >
          <div className="rounded-xl p-2 shrink-0 bg-white/20">
            <ScanSearch size={22} />
          </div>
          <div>
            <p className="font-semibold text-sm">Check a book</p>
            <p className="text-xs mt-0.5 text-indigo-200">
              Scan to check a book — or claim one that isn&apos;t on the list yet
            </p>
          </div>
        </button>

        {wishlistBooks.length === 0 ? (
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
                    <BookCard
                      key={book.id}
                      book={book}
                      onGuestUnclaim={
                        guestClaimedIds.has(book.id)
                          ? () => void handleGuestUnclaim(book.id)
                          : undefined
                      }
                    />
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

      {showCheckBook && (
        <CheckBookModal
          books={checkBooks}
          children={guestChild}
          dispatch={guestDispatch}
          mode="guest"
          onClaim={handleGuestClaim}
          guestClaimedBookIds={guestClaimedIds}
          onGuestUnclaim={(bookId) => void handleGuestUnclaim(bookId)}
          onClose={() => setShowCheckBook(false)}
        />
      )}
    </div>
  );
}
