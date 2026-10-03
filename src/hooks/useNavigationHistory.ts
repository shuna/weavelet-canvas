import { useEffect, useRef } from 'react';
import useStore from '@store/store';

function isPWA(): boolean {
  return (
    (navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

export { isPWA };

export default function useNavigationHistory() {
  const initNavigationEntry = useStore((s) => s.initNavigationEntry);
  const initialized = useRef(false);
  const isRestoringRef = useRef(false);

  // Initialize first entry
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      initNavigationEntry();
    }
  }, [initNavigationEntry]);

  // Browser History API integration (non-PWA only)
  useEffect(() => {
    if (isPWA()) return;

    let prevCurrentKey: string | null =
      useStore.getState().navHistoryCurrent?.key ?? null;

    const unsub = useStore.subscribe((state, prevState) => {
      const currentKey = state.navHistoryCurrent?.key ?? null;
      if (currentKey && currentKey !== prevCurrentKey && !isRestoringRef.current) {
        if (state.isRestoringNavigation) {
          // Toolbar and branch-editor controls use the same store actions.
          const pastIndex = prevState.navHistoryPast.findIndex((entry) => entry.key === currentKey);
          const futureIndex = prevState.navHistoryFuture.findIndex((entry) => entry.key === currentKey);
          if (pastIndex >= 0) history.go(pastIndex - prevState.navHistoryPast.length);
          else if (futureIndex >= 0) history.go(futureIndex + 1);
        } else {
          history.pushState({ navKey: currentKey }, '');
        }
      }
      prevCurrentKey = currentKey;
    });

    const handlePopState = (event: PopStateEvent) => {
      const navKey = event.state?.navKey;
      if (!navKey) return;

      isRestoringRef.current = true;

      const state = useStore.getState();
      const entry = state.navEntryMap.get(navKey);
      if (entry) {
        const pastKeys = state.navHistoryPast.map((e) => e.key);
        const futureKeys = state.navHistoryFuture.map((e) => e.key);

        // Keep the native history index aligned when a chat has been deleted.
        if (!state.chats?.some((chat) => chat.id === entry.chatId)) {
          const pastIndex = pastKeys.indexOf(navKey);
          const futureIndex = futureKeys.indexOf(navKey);
          const candidates = pastIndex >= 0
            ? state.navHistoryPast.slice(0, pastIndex).reverse()
            : futureIndex >= 0 ? state.navHistoryFuture.slice(futureIndex + 1) : [];
          const next = candidates.findIndex((candidate) => state.chats?.some((chat) => chat.id === candidate.chatId));
          const distance = next >= 0 ? next + 1 : pastIndex >= 0 ? pastKeys.length - pastIndex : -(futureIndex + 1);
          if (pastIndex >= 0 || futureIndex >= 0) {
            history.go(next >= 0 && pastIndex >= 0 ? -distance : distance);
          }
          isRestoringRef.current = false;
          return;
        }

        if (pastKeys.includes(navKey)) {
          let remaining = pastKeys.length;
          while (
            useStore.getState().navHistoryCurrent?.key !== navKey &&
            useStore.getState().canNavBack() &&
            remaining-- > 0
          ) {
            useStore.getState().navBack();
          }
        } else if (futureKeys.includes(navKey)) {
          let remaining = futureKeys.length;
          while (
            useStore.getState().navHistoryCurrent?.key !== navKey &&
            useStore.getState().canNavForward() &&
            remaining-- > 0
          ) {
            useStore.getState().navForward();
          }
        }
      }

      isRestoringRef.current = false;
    };

    window.addEventListener('popstate', handlePopState);

    // Set initial history state
    const current = useStore.getState().navHistoryCurrent;
    if (current) {
      history.replaceState({ navKey: current.key }, '');
    }

    return () => {
      unsub();
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);
}
