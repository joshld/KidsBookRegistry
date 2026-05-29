import { useReducer, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import type { AppState, Action } from './types';
import { loadState, saveState } from './lib/storage';
import { useTheme } from './lib/useTheme';
import DashboardView from './views/DashboardView';
import RegistryView from './views/RegistryView';
import PublicGuestView from './views/PublicGuestView';

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_PROFILE':
      return { ...state, profile: action.profile };
    case 'ADD_CHILD':
      return { ...state, children: [...state.children, action.child] };
    case 'ADD_BOOK':
      return { ...state, books: [...state.books, action.book] };
    case 'CLAIM_BOOK':
      return {
        ...state,
        books: state.books.map((b) =>
          b.id === action.bookId
            ? { ...b, status: 'Claimed', claimedBy: action.claimedBy }
            : b,
        ),
      };
    case 'UNCLAIM_BOOK':
      return {
        ...state,
        books: state.books.map((b) =>
          b.id === action.bookId
            ? { ...b, status: 'Available', claimedBy: undefined }
            : b,
        ),
      };
    case 'REMOVE_BOOK':
      return {
        ...state,
        books: state.books.filter((b) => b.id !== action.bookId),
      };
    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    saveState(state);
  }, [state]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<DashboardView state={state} dispatch={dispatch} theme={theme} toggleTheme={toggleTheme} />}
        />
        <Route
          path="/registry/:childId"
          element={<RegistryView state={state} dispatch={dispatch} theme={theme} toggleTheme={toggleTheme} />}
        />
        <Route
          path="/share/:childId"
          element={<PublicGuestView dispatch={dispatch} />}
        />
      </Routes>
    </BrowserRouter>
  );
}
