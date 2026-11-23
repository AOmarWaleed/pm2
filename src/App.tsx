import React from 'react';
import { Loader2 } from 'lucide-react';
import { ToastContainer } from './components/common/Badges';
import { ConfirmDangerModal } from './components/common/ConfirmDangerModal';
import { FleetOverview } from './components/fleet/FleetOverview';
import { TopTabBar } from './components/layout/TopTabBar';
import { AlertsCenterModal } from './components/modals/AlertsCenterModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { VaultLockScreen } from './components/vault/VaultLockScreen';
import { ServerWorkspace } from './components/workspace/ServerWorkspace';
import { I18nProvider } from './i18n';
import { AppProvider, useApp } from './store/appStore';

const MainShell: React.FC = () => {
  const { vaultState, loadingVault, servers, activeTabId } = useApp();

  if (loadingVault) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-zinc-950">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (vaultState !== 'unlocked') {
    return (
      <>
        <VaultLockScreen />
        <ToastContainer />
      </>
    );
  }

  const activeServer =
    activeTabId !== 'fleet'
      ? servers.find((s) => s.id === activeTabId)
      : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <TopTabBar />
      <div className="min-h-0 flex-1">
        {activeServer ? (
          <ServerWorkspace key={activeServer.id} server={activeServer} />
        ) : (
          <FleetOverview />
        )}
      </div>
      <AlertsCenterModal />
      <SettingsModal />
      <ConfirmDangerModal />
      <ToastContainer />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <I18nProvider>
      <AppProvider>
        <MainShell />
      </AppProvider>
    </I18nProvider>
  );
};

export default App;
