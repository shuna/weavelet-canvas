import { StoreSlice } from './store';

export interface MigrationUiState {
  visible: boolean;
  status: 'needs-export-import' | 'storage-recovery-required' | 'remote-migration-required' | 'done';
  details?: string[];
  legacyRemoteSnapshots?: { id: string; version: number }[];
}

export interface MigrationSlice {
  migrationUiState: MigrationUiState | null;
  refreshLegacyRemoteMigration: () => Promise<void>;
  setMigrationUiState: (state: MigrationUiState | null) => void;
}

export const createMigrationSlice: StoreSlice<MigrationSlice> = (set) => ({
  migrationUiState: null,
  refreshLegacyRemoteMigration: async () => {
    const { loadLegacyRemoteSnapshots } = await import('./storage/IndexedDbStorage');
    const records = await loadLegacyRemoteSnapshots();
    set((state) => {
      if (records.length) return { migrationUiState: {
        ...state.migrationUiState,
        visible: true,
        status: state.migrationUiState?.status === 'storage-recovery-required' || state.migrationUiState?.status === 'needs-export-import'
          ? state.migrationUiState.status : 'remote-migration-required',
        legacyRemoteSnapshots: records.map(({ id, snapshot }) => ({ id, version: snapshot.version })),
      } };
      if (state.migrationUiState?.status === 'remote-migration-required') return { migrationUiState: null };
      if (state.migrationUiState?.legacyRemoteSnapshots) return { migrationUiState: {
        ...state.migrationUiState, legacyRemoteSnapshots: undefined,
      } };
      return {};
    });
  },
  setMigrationUiState: (migrationUiState) => {
    set((prev) => ({ ...prev, migrationUiState }));
  },
});
