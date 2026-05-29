import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { Action, AppState } from '../types';
import { registryService } from '../lib/storage/registryService';
import type { SyncStatus } from '../lib/storage/registryService';
import { getProviderConfig } from '../lib/storage/localCache';

const DEFAULT_STATE: AppState = {
  profile: null,
  children: [],
  books: [],
};

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
      return { ...state, books: state.books.filter((b) => b.id !== action.bookId) };
    case 'REPLACE_STATE':
      return action.state;
    default:
      return state;
  }
}

type RegistryContextValue = {
  state: AppState;
  dispatch: Dispatch<Action>;
  bootPhase: 'loading' | 'setup' | 'unlock' | 'ready';
  syncStatus: SyncStatus;
  connectDrive: () => Promise<void>;
  connectLocal: () => Promise<void>;
  unlock: (passphrase: string, remember: boolean) => Promise<void>;
  setupPassphrase: (passphrase: string, remember: boolean) => Promise<void>;
  providerType: 'local' | 'google-drive' | null;
  mergeRemoteClaims: () => Promise<void>;
  buildShareUrl: (childId: string) => string | null;
  prepareShareLink: (childId: string) => Promise<string | null>;
};

const RegistryContext = createContext<RegistryContextValue | null>(null);

export function RegistryProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, DEFAULT_STATE);
  const [bootPhase, setBootPhase] = useState<'loading' | 'setup' | 'unlock' | 'ready'>('loading');
  const [providerType, setProviderType] = useState<'local' | 'google-drive' | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(registryService.getSyncStatus());

  useEffect(() => {
    return registryService.onSyncStatus(setSyncStatus);
  }, []);

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    if (bootPhase !== 'ready') return;
    registryService.scheduleSave(state);
  }, [state, bootPhase]);

  async function boot() {
    setBootPhase('loading');
    const config = await getProviderConfig();

    if (!config) {
      setBootPhase('setup');
      return;
    }

    setProviderType(config.type);
    await registryService.initializeFromConfig();

    const remembered = await registryService.tryRememberedUnlock();
    if (remembered) {
      try {
        await registryService.load();
        dispatch({ type: 'REPLACE_STATE', state: registryService.getAppState() } as Action);
        await registryService.mergeRemoteClaims();
        dispatch({ type: 'REPLACE_STATE', state: registryService.getAppState() } as Action);
        setBootPhase('ready');
        return;
      } catch {
        registryService.lock();
      }
    }

    setBootPhase('unlock');
  }

  const connectDrive = useCallback(async () => {
    await registryService.connectProvider('google-drive');
    setProviderType('google-drive');
    setBootPhase('unlock');
  }, []);

  const connectLocal = useCallback(async () => {
    await registryService.connectProvider('local');
    setProviderType('local');
    setBootPhase('unlock');
  }, []);

  const unlock = useCallback(async (passphrase: string, remember: boolean) => {
    await registryService.unlockWithPassphrase(passphrase, remember);
    await registryService.load();
    dispatch({ type: 'REPLACE_STATE', state: registryService.getAppState() } as Action);
    await registryService.mergeRemoteClaims();
    dispatch({ type: 'REPLACE_STATE', state: registryService.getAppState() } as Action);
    await registryService.flushPending();
    setBootPhase('ready');
  }, []);

  const setupPassphrase = useCallback(async (passphrase: string, remember: boolean) => {
    await registryService.unlockWithPassphrase(passphrase, remember);
    dispatch({ type: 'REPLACE_STATE', state: DEFAULT_STATE } as Action);
    await registryService.save(DEFAULT_STATE);
    setBootPhase('ready');
  }, []);

  const mergeRemoteClaims = useCallback(async () => {
    const merged = await registryService.mergeRemoteClaims();
    if (merged) dispatch({ type: 'REPLACE_STATE', state: merged } as Action);
  }, []);

  const buildShareUrl = useCallback((childId: string) => {
    return registryService.buildShareUrl(childId);
  }, []);

  const prepareShareLink = useCallback(async (childId: string) => {
    return registryService.prepareShareLink(childId, state);
  }, [state]);

  return (
    <RegistryContext.Provider
      value={{
        state,
        dispatch,
        bootPhase,
        syncStatus,
        connectDrive,
        connectLocal,
        unlock,
        setupPassphrase,
        providerType,
        mergeRemoteClaims,
        buildShareUrl,
        prepareShareLink,
      }}
    >
      {children}
    </RegistryContext.Provider>
  );
}

export function useRegistry() {
  const ctx = useContext(RegistryContext);
  if (!ctx) throw new Error('useRegistry must be used within RegistryProvider');
  return ctx;
}
