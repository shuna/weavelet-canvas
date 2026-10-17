import { StoreSlice } from './store';
import { SearchResult } from '@utils/branchSearch';
import { reconcileSearchResults, saveSearchHistory, stepSearchResult } from '@utils/searchState';

export interface SearchSlice {
  searchQuery: string;
  searchHistory: string[];
  searchScope: 'all' | 'activePath';
  searchResults: SearchResult[];
  currentResultIndex: number;
  isSearchOpen: boolean;
  matchedNodeIds: Set<string>;
  currentResultNodeId: string | null;
  starredOnly: boolean;

  setSearchQuery: (q: string) => void;
  saveSearchQueryToHistory: (query?: string) => void;
  clearSearchHistory: () => void;
  setSearchResults: (results: SearchResult[]) => void;
  toggleSearchScope: () => void;
  toggleStarredOnly: () => void;
  nextResult: () => void;
  prevResult: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;
}

export const createSearchSlice: StoreSlice<SearchSlice> = (set, get) => ({
  searchQuery: '',
  searchHistory: [],
  searchScope: 'all',
  searchResults: [],
  currentResultIndex: -1,
  isSearchOpen: true,
  matchedNodeIds: new Set(),
  currentResultNodeId: null,
  starredOnly: false,

  setSearchQuery: (q) => {
    set({ searchQuery: q });
  },

  saveSearchQueryToHistory: (query) => {
    const nextHistory = saveSearchHistory(get().searchHistory, query ?? get().searchQuery);
    if (nextHistory === get().searchHistory) return;
    set({ searchHistory: nextHistory });
  },

  clearSearchHistory: () => {
    set({ searchHistory: [] });
  },

  setSearchResults: (results) => {
    const matchedNodeIds = new Set(results.map((r) => r.nodeId));
    const { index: currentResultIndex, shouldNavigate: shouldNavigateToCurrentResult } =
      reconcileSearchResults(get().searchResults, get().currentResultIndex, results);
    const currentResultNodeId =
      currentResultIndex >= 0 ? results[currentResultIndex].nodeId : null;

    set({ searchResults: results, matchedNodeIds, currentResultIndex, currentResultNodeId });

    if (shouldNavigateToCurrentResult) {
      get().navigateToNode({ ...results[currentResultIndex], source: 'search', history: 'push', selectChat: false, focus: 'editor' });
    }
  },

  toggleSearchScope: () => {
    set({ searchScope: get().searchScope === 'all' ? 'activePath' : 'all' });
  },

  toggleStarredOnly: () => {
    set({ starredOnly: !get().starredOnly });
  },

  nextResult: () => {
    const { searchResults, currentResultIndex } = get();
    if (searchResults.length === 0) return;
    get().saveSearchQueryToHistory();
    const next = stepSearchResult(currentResultIndex, searchResults.length, false);
    const result = searchResults[next];
    set({ currentResultIndex: next, currentResultNodeId: result.nodeId });
    get().navigateToNode({ ...result, source: 'search', history: 'push', selectChat: false, focus: 'editor' });
  },

  prevResult: () => {
    const { searchResults, currentResultIndex } = get();
    if (searchResults.length === 0) return;
    get().saveSearchQueryToHistory();
    const prev = stepSearchResult(currentResultIndex, searchResults.length, true);
    const result = searchResults[prev];
    set({ currentResultIndex: prev, currentResultNodeId: result.nodeId });
    get().navigateToNode({ ...result, source: 'search', history: 'push', selectChat: false, focus: 'editor' });
  },

  openSearch: () => {
    set({ isSearchOpen: true });
  },

  closeSearch: () => {
    get().saveSearchQueryToHistory();
    set({
      isSearchOpen: false,
      searchQuery: '',
      searchResults: [],
      currentResultIndex: -1,
      matchedNodeIds: new Set(),
      currentResultNodeId: null,
      starredOnly: false,
    });
  },

  toggleSearch: () => {
    if (get().isSearchOpen) {
      get().closeSearch();
    } else {
      get().openSearch();
    }
  },
});
