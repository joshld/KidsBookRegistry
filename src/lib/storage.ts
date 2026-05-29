import type { AppState } from '../types';

const STORAGE_KEY = 'kbr_state';

const DEFAULT_STATE: AppState = {
  profile: null,
  children: [],
  books: [],
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const state = JSON.parse(raw) as AppState;

    // Migration: books saved before listType was introduced default to 'owned'
    state.books = state.books.map((b) =>
      b.listType ? b : { ...b, listType: 'owned' as const },
    );

    return state;
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (e.g. private browsing quota exceeded)
  }
}
