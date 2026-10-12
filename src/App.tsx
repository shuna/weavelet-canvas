import React, { useEffect } from 'react';
import { startFileSystemSync } from '@store/storage/FileSystemSync';
import useStore from '@store/store';

import Chat from '@components/Chat';
import LocalFilePreview, { useImportPreviewSession } from '@components/ImportExportChat/LocalFilePreview';
import Menu from '@components/Menu';

import useStreamRecovery from '@hooks/useStreamRecovery';
import useOpenRouterVerification from '@hooks/useOpenRouterVerification';
import useIosStatusBarScroll from '@hooks/useIosStatusBarScroll';
import useAppBootstrap from '@hooks/useAppBootstrap';
import useLocalModelRehydration from '@hooks/useLocalModelRehydration';
import Toast from '@components/Toast';
import LegacyCustomModelsBanner from '@components/LegacyCustomModelsBanner';
import MigrationProgressBanner from '@components/MigrationProgressBanner';
import OnboardingModal from '@components/Onboarding/OnboardingModal';
import LowbitQValidationPage from '@components/LowbitQValidation/LowbitQValidationPage';
import BootstrapLoading from '@components/BootstrapLoading';

function isLowbitQValidationRoute(): boolean {
  const params = new URLSearchParams(window.location.search);
  return (
    window.location.pathname === '/lowbit-q-validation' ||
    window.location.hash === '#lowbit-q-validation' ||
    params.get('lowbit-q-validation') === '1'
  );
}

function App() {
  const preview = useImportPreviewSession();
  const { isBootstrapped, bootPhase, bootProgress } = useAppBootstrap();
  const localModelEnabled = useStore((state) => state.localModelEnabled);
  useLocalModelRehydration(isBootstrapped && localModelEnabled);
  useEffect(() => {
    if (isBootstrapped) return startFileSystemSync();
  }, [isBootstrapped]);
  useStreamRecovery();
  useOpenRouterVerification();
  useIosStatusBarScroll();

  React.useEffect(() => { document.getElementById('boot-status')?.remove(); }, []);

  if (!isBootstrapped) return <BootstrapLoading phase={bootPhase} progress={bootProgress} />;

  if (isLowbitQValidationRoute()) {
    return <LowbitQValidationPage />;
  }

  return (
    <div className='overflow-hidden w-full h-full relative'>
      {!preview.source && <>
        <OnboardingModal />
        <LegacyCustomModelsBanner />
        <MigrationProgressBanner />
      </>}
      {preview.source ? <LocalFilePreview source={preview.source} fileName={preview.fileName} /> : <>
        <Menu />
        <div className='flex h-full flex-1 flex-col'><Chat /></div>
      </>}
      <Toast />
    </div>
  );
}

export default App;
