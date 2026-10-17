export type SearchIdentity = { nodeId: string | null; chatId: string; resultId?: string };

export function saveSearchHistory(history: string[], query: string): string[] {
  const normalized = query.trim();
  return normalized ? [normalized, ...history.filter(entry => entry !== normalized)].slice(0, 20) : history;
}

export function reconcileSearchResults(previous: SearchIdentity[], index: number, results: SearchIdentity[]) {
  const previousResult = previous[index];
  const previousNodeId = previousResult?.nodeId;
  const preservedIndex = previousNodeId
    ? results.findIndex(result => result.nodeId === previousNodeId && result.chatId === previousResult?.chatId)
    : previousResult?.resultId
      ? results.findIndex(result => result.nodeId === null && result.resultId === previousResult.resultId && result.chatId === previousResult.chatId)
      : -1;
  const nextIndex = results.length === 0 ? -1 : preservedIndex >= 0 ? preservedIndex : 0;
  const nextNodeId = nextIndex >= 0 ? results[nextIndex].nodeId : null;
  return {
    index: nextIndex,
    shouldNavigate: nextNodeId !== null && (nextNodeId !== previousNodeId || results[nextIndex]?.chatId !== previousResult?.chatId),
  };
}

export function stepSearchResult(index: number, count: number, backward: boolean): number {
  if (count === 0) return -1;
  return backward ? (index - 1 + count) % count : (index + 1) % count;
}
