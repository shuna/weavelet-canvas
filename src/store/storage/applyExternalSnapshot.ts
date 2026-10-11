import useStore from '@store/store';
import { invalidateAiTasks } from '@hooks/aiTaskLifetime';
import { createPersistedChatDataState, prepareHydratedState, reportHydratedStateCommitted, type PersistedStoreState } from '@store/persistence';
import { STORE_VERSION } from '@store/version';
import { preserveLegacyRemoteSnapshot, saveChatData } from './IndexedDbStorage';

// A changed session or local edit leaves the downloaded payload unapplied.
export async function applyExternalSnapshot(payload: Partial<PersistedStoreState>, sessionIsCurrent: () => boolean, observed = useStore.getState(), version = STORE_VERSION): Promise<boolean> {
  if (!sessionIsCurrent() || observed !== useStore.getState()) return false;
  if (version !== STORE_VERSION) {
    await preserveLegacyRemoteSnapshot({ state: payload, version });
    await useStore.getState().refreshLegacyRemoteMigration();
    throw new Error('The downloaded snapshot uses a different data version. It was preserved for export and import; current chats were not replaced.');
  }
  invalidateAiTasks();
  const base = useStore.getState();
  // The downloaded payload was based on the pre-cancellation content.
  if (base.chats !== observed.chats || base.contentStore !== observed.contentStore) return false;
  const prepared = await prepareHydratedState(base, payload);
  if (base !== useStore.getState() || !sessionIsCurrent()) return false;
  useStore.setState({ ...prepared.state, branchHistoryPast: [], branchHistoryFuture: [] });
  const applied = useStore.getState();
  await saveChatData(createPersistedChatDataState(applied));
  if (applied === useStore.getState()) reportHydratedStateCommitted(prepared);
  return sessionIsCurrent();
}
