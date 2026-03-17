import { StoreSlice } from './store';

export interface MigrationUiState {
  visible: boolean;
  status: 'running' | 'finalizing' | 'failed' | 'done';
  progress: number; // 0..1
  migratedChats: number;
  totalChats: number;
  sourceSizeBytes: number;
  currentPhase: 'snapshot' | 'migrating-chats' | 'finalizing';
  resumable: boolean;
  lastError?: string;
}

export interface MigrationSlice {
  migrationUiState: MigrationUiState | null;
  setMigrationUiState: (state: MigrationUiState | null) => void;
}

export const createMigrationSlice: StoreSlice<MigrationSlice> = (set) => ({
  migrationUiState: null,
  setMigrationUiState: (migrationUiState) => {
    set((prev) => ({ ...prev, migrationUiState }));
  },
});
