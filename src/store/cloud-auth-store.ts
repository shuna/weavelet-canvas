import { StoreApi, create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CloudAuthSlice, createCloudAuthSlice } from './cloud-auth-slice';

export type StoreState = CloudAuthSlice;

export type StoreSlice<T> = (
  set: StoreApi<StoreState>['setState'],
  get: StoreApi<StoreState>['getState']
) => T;

const useCloudAuthStore = create<StoreState>()(
  persist(
    (set, get) => ({
      ...createCloudAuthSlice(set, get),
    }),
    {
      name: 'cloud',
      partialize: (state) => ({
        cloudSync: state.cloudSync,
        fileId: state.fileId,
        syncTargetConfirmed: state.syncTargetConfirmed,
      }),
      version: 2,
    }
  )
);

export default useCloudAuthStore;
