import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RegistryProvider, useRegistry } from './context/RegistryContext';
import { useTheme } from './lib/useTheme';
import { registryService } from './lib/storage/registryService';
import type { Action } from './types';
import DashboardView from './views/DashboardView';
import RegistryView from './views/RegistryView';
import PublicGuestView from './views/PublicGuestView';
import SetupView from './views/SetupView';
import OAuthCallbackView from './views/OAuthCallbackView';
import SyncBanner from './components/SyncBanner';

function AppRoutes() {
  const {
    bootPhase,
    state,
    dispatch,
    theme,
    toggleTheme,
    prepareShareLink,
    mergeRemoteClaims,
    syncStatus,
  } = useAppShell();

  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setConflictMessage(registryService.getConflictMessage());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  async function resolveConflict(useRemote: boolean) {
    const merged = await registryService.resolveConflict(useRemote, state);
    dispatch({ type: 'REPLACE_STATE', state: merged } as Action);
    setConflictMessage(null);
  }

  if (bootPhase !== 'ready') {
    return <SetupView />;
  }

  return (
    <>
      <SyncBanner
        status={syncStatus}
        conflictMessage={conflictMessage}
        onResolveConflict={(useRemote) => void resolveConflict(useRemote)}
        onSyncClaims={() => void mergeRemoteClaims()}
      />
      <Routes>
        <Route
          path="/"
          element={
            <DashboardView
              state={state}
              dispatch={dispatch}
              theme={theme}
              toggleTheme={toggleTheme}
              syncStatus={syncStatus}
              prepareShareLink={prepareShareLink}
            />
          }
        />
        <Route
          path="/registry/:childId"
          element={
            <RegistryView state={state} dispatch={dispatch} theme={theme} toggleTheme={toggleTheme} />
          }
        />
        <Route path="/oauth/callback" element={<OAuthCallbackView />} />
      </Routes>
    </>
  );
}

function useAppShell() {
  const registry = useRegistry();
  const { theme, toggleTheme } = useTheme();
  return { ...registry, theme, toggleTheme };
}

export default function App() {
  return (
    <RegistryProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/oauth/callback" element={<OAuthCallbackView />} />
          {/* Guest wish lists — no cloud login or passphrase on the visitor's device */}
          <Route path="/share/:childId" element={<PublicGuestView />} />
          <Route path="/*" element={<AppRoutes />} />
        </Routes>
      </BrowserRouter>
    </RegistryProvider>
  );
}
