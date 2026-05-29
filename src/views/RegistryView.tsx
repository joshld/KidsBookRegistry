import { useState, type Dispatch } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PlusCircle, Library, Gift, Sun, Moon } from 'lucide-react';
import type { AppState, Action, ListType } from '../types';
import BookCard from '../components/BookCard';
import AddBookModal from '../components/AddBookModal';

type Tab = 'owned' | 'wishlist';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export default function RegistryView({ state, dispatch, theme, toggleTheme }: Props) {
  const navigate = useNavigate();
  const { childId } = useParams<{ childId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('owned');
  const [addingListType, setAddingListType] = useState<ListType | null>(null);

  const child = state.children.find((c) => c.id === childId);
  const allBooks = state.books.filter((b) => b.childId === childId);
  const ownedBooks = allBooks.filter((b) => b.listType === 'owned');
  const wishlistBooks = allBooks.filter((b) => b.listType === 'wishlist');
  const wishlistAvailable = wishlistBooks.filter((b) => b.status === 'Available');
  const wishlistClaimed = wishlistBooks.filter((b) => b.status === 'Claimed');

  if (!child) {
    return (
      <div className="min-h-svh bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <p className="text-slate-500 dark:text-slate-400 text-sm">Child not found.</p>
      </div>
    );
  }

  const tabBooks = activeTab === 'owned' ? ownedBooks : wishlistBooks;

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white active:opacity-60 p-1 -ml-1"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-slate-900 dark:text-white truncate">{child.name}'s Books</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {ownedBooks.length} owned · {wishlistBooks.length} on wish list
            </p>
          </div>
          <button
            onClick={toggleTheme}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white active:opacity-60 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* Tabs */}
        <div className="max-w-lg mx-auto px-4 flex gap-1 pb-0">
          <button
            onClick={() => setActiveTab('owned')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'owned'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Library size={15} />
            Library
            {ownedBooks.length > 0 && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                activeTab === 'owned'
                  ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
              }`}>
                {ownedBooks.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('wishlist')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'wishlist'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Gift size={15} />
            Wish List
            {wishlistBooks.length > 0 && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                activeTab === 'wishlist'
                  ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
              }`}>
                {wishlistBooks.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 pb-24 space-y-6">
        {tabBooks.length === 0 ? (
          <div className="text-center py-16 text-slate-400 dark:text-slate-500">
            {activeTab === 'owned' ? (
              <>
                <Library size={40} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No books in the library yet</p>
                <p className="text-sm mt-1">Tap <strong>+</strong> to scan a book {child.name} owns.</p>
              </>
            ) : (
              <>
                <Gift size={40} className="mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No books on the wish list yet</p>
                <p className="text-sm mt-1">Tap <strong>+</strong> to add a book {child.name} would like.</p>
              </>
            )}
          </div>
        ) : activeTab === 'owned' ? (
          <div className="space-y-3">
            {ownedBooks.map((book) => (
              <BookCard key={book.id} book={book} dispatch={dispatch} />
            ))}
          </div>
        ) : (
          <>
            {wishlistAvailable.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                  Still needed ({wishlistAvailable.length})
                </h2>
                <div className="space-y-3">
                  {wishlistAvailable.map((book) => (
                    <BookCard key={book.id} book={book} dispatch={dispatch} />
                  ))}
                </div>
              </section>
            )}
            {wishlistClaimed.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                  Being bought ({wishlistClaimed.length})
                </h2>
                <div className="space-y-3">
                  {wishlistClaimed.map((book) => (
                    <BookCard key={book.id} book={book} dispatch={dispatch} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <button
        onClick={() => setAddingListType(activeTab)}
        className="fixed bottom-6 right-6 bg-indigo-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center hover:bg-indigo-700 active:scale-95 transition-all z-20"
        aria-label={activeTab === 'owned' ? 'Add to library' : 'Add to wish list'}
      >
        <PlusCircle size={28} />
      </button>

      {addingListType && (
        <AddBookModal
          childId={child.id}
          listType={addingListType}
          books={state.books}
          children={state.children}
          dispatch={dispatch}
          onClose={() => setAddingListType(null)}
        />
      )}
    </div>
  );
}
