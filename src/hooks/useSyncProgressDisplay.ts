import { useEffect, useState } from 'react';
import { useGoogleSyncProgress } from '@store/storage/google/progress';

// Throttle only the displayed snapshot; transfer accounting stays immediate.
export function useSyncProgressDisplay() {
  const [progress, setProgress] = useState(useGoogleSyncProgress.getState);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!document.hidden) setProgress(useGoogleSyncProgress.getState());
    };
    const unsubscribe = useGoogleSyncProgress.subscribe((next, previous) => {
      if (document.hidden) return;
      if (next.active !== previous.active || next.phase !== previous.phase) publish();
      else if (!timer) timer = setTimeout(publish, 1000);
    });
    const visibilityChanged = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!document.hidden) publish();
    };
    publish();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);
  return progress;
}
