import { useState, type Dispatch } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, PlusCircle, User, Share2, ScanSearch, Sun, Moon } from 'lucide-react';
import type { AppState, Action } from '../types';
import type { SyncStatus } from '../lib/storage/registryService';
import { crypto } from '../lib/uid';
import CheckBookModal from '../components/CheckBookModal';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  syncStatus: SyncStatus;
  prepareShareLink: (childId: string) => Promise<string | null>;
}

export default function DashboardView({
  state,
  dispatch,
  theme,
  toggleTheme,
  syncStatus,
  prepareShareLink,
}: Props) {
  const navigate = useNavigate();
  const [showProfileSetup, setShowProfileSetup] = useState(!state.profile);
  const [shareFeedback, setShareFeedback] = useState<{ childId: string; message: string; tone: 'ok' | 'err' } | null>(null);
  const [email, setEmail] = useState('');
  const [showAddChild, setShowAddChild] = useState(false);
  const [childName, setChildName] = useState('');
  const [showCheckBook, setShowCheckBook] = useState(false);

  function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    dispatch({ type: 'SET_PROFILE', profile: { id: crypto(), email: email.trim() } });
    setShowProfileSetup(false);
  }

  function handleAddChild(e: React.FormEvent) {
    e.preventDefault();
    if (!childName.trim() || !state.profile) return;
    dispatch({ type: 'ADD_CHILD', child: { id: crypto(), profileId: state.profile.id, name: childName.trim() } });
    setChildName('');
    setShowAddChild(false);
  }

  function bookCounts(childId: string) {
    const books = state.books.filter((b) => b.childId === childId);
    const owned = books.filter((b) => b.listType === 'owned').length;
    const wished = books.filter((b) => b.listType === 'wishlist').length;
    return { owned, wished };
  }

  async function copyShareLink(childId: string) {
    setShareFeedback(null);
    if (syncStatus.state === 'saving') {
      setShareFeedback({ childId, message: 'Still saving — try again in a moment', tone: 'err' });
      return;
    }
    try {
      const url = await prepareShareLink(childId);
      if (!url) {
        setShareFeedback({ childId, message: 'Could not build share link', tone: 'err' });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareFeedback({ childId, message: 'Share link copied', tone: 'ok' });
      window.setTimeout(() => setShareFeedback((f) => (f?.childId === childId ? null : f)), 3000);
    } catch (err) {
      setShareFeedback({
        childId,
        message: err instanceof Error ? err.message : 'Could not copy share link',
        tone: 'err',
      });
    }
  }

  if (showProfileSetup) {
    return (
      <div className="min-h-svh bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 w-full max-w-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-indigo-100 dark:bg-indigo-900/50 p-2 rounded-xl">
              <BookOpen className="text-indigo-600 dark:text-indigo-400" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-white leading-tight">KidsBookRegistry</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">Track books for your little ones</p>
            </div>
          </div>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Your email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button type="submit" className="w-full bg-indigo-600 text-white rounded-xl py-3 font-medium text-sm hover:bg-indigo-700 active:scale-95 transition-all">
              Get started
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="bg-indigo-100 dark:bg-indigo-900/50 p-1.5 rounded-lg">
            <BookOpen className="text-indigo-600 dark:text-indigo-400" size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold text-slate-900 dark:text-white truncate">KidsBookRegistry</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
              <User size={11} />
              {state.profile?.email}
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
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 pb-24">
        {/* Check a book */}
        <button
          onClick={() => state.books.length > 0 && setShowCheckBook(true)}
          disabled={state.books.length === 0}
          className={`w-full mb-5 rounded-2xl px-4 py-4 flex items-center gap-3 text-left transition-all ${
            state.books.length > 0
              ? 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:scale-95'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
          }`}
        >
          <div className={`rounded-xl p-2 shrink-0 ${state.books.length > 0 ? 'bg-white/20' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <ScanSearch size={22} />
          </div>
          <div>
            <p className="font-semibold text-sm">Check a book</p>
            <p className={`text-xs mt-0.5 ${state.books.length > 0 ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'}`}>
              {state.books.length > 0 ? "Scan a barcode to see if it's already owned or claimed" : 'Add books to a registry first'}
            </p>
          </div>
        </button>

        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Your Children</h2>

        {state.children.length === 0 ? (
          <div className="text-center py-16 text-slate-400 dark:text-slate-500">
            <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">No children added yet.</p>
            <p className="text-sm">Tap <strong>+</strong> to add your first child.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {state.children.map((child) => (
              <div key={child.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                <button
                  onClick={() => navigate(`/registry/${child.id}`)}
                  className="w-full text-left px-4 py-4 flex items-center gap-3 active:bg-slate-50 dark:active:bg-slate-700"
                >
                  <div className="bg-indigo-100 dark:bg-indigo-900/50 rounded-full w-10 h-10 flex items-center justify-center shrink-0">
                    <span className="text-indigo-700 dark:text-indigo-400 font-semibold text-sm">{child.name[0].toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white truncate">{child.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {(() => {
                        const { owned, wished } = bookCounts(child.id);
                        if (owned === 0 && wished === 0) return 'No books yet';
                        const parts = [];
                        if (owned > 0) parts.push(`${owned} owned`);
                        if (wished > 0) parts.push(`${wished} on wish list`);
                        return parts.join(' · ');
                      })()}
                    </p>
                  </div>
                  <span className="text-slate-300 dark:text-slate-600 text-lg">›</span>
                </button>
                <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-2 flex items-center justify-between gap-2">
                  <button
                    onClick={() => void copyShareLink(child.id)}
                    disabled={syncStatus.state === 'saving'}
                    className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 active:opacity-60 disabled:opacity-50"
                  >
                    <Share2 size={12} />
                    Copy share link
                  </button>
                  {shareFeedback?.childId === child.id && (
                    <span
                      className={`text-xs truncate ${
                        shareFeedback.tone === 'ok'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {shareFeedback.message}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add Child FAB */}
      <button
        onClick={() => setShowAddChild(true)}
        className="fixed bottom-6 right-6 bg-indigo-600 text-white w-14 h-14 rounded-full shadow-lg flex items-center justify-center hover:bg-indigo-700 active:scale-95 transition-all z-20"
        aria-label="Add child"
      >
        <PlusCircle size={28} />
      </button>

      {showCheckBook && (
        <CheckBookModal books={state.books} children={state.children} dispatch={dispatch} onClose={() => setShowCheckBook(false)} />
      )}

      {/* Add Child Modal */}
      {showAddChild && (
        <div
          className="fixed inset-0 bg-black/40 flex items-end justify-center z-30 p-4"
          onClick={(e) => e.target === e.currentTarget && setShowAddChild(false)}
        >
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-sm p-5 mb-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Add a child</h3>
            <form onSubmit={handleAddChild} className="space-y-4">
              <input
                type="text"
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                placeholder="Child's name"
                autoFocus
                required
                className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddChild(false)}
                  className="flex-1 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl py-3 text-sm font-medium"
                >
                  Cancel
                </button>
                <button type="submit" className="flex-1 bg-indigo-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-indigo-700 active:scale-95 transition-all">
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
