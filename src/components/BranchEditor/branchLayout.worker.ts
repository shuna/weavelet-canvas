import { layoutBranchEntries, type WorkerInput } from '../../utils/branchLayout';

export type { WorkerInput, WorkerOutput, PlainNode, PlainEdge } from '../../utils/branchLayout';

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  self.postMessage(layoutBranchEntries(e.data));
};
