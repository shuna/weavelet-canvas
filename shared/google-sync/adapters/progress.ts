export const syncPhase = () => {};
export const completedFile = () => {};
export const syncStage = async (_start: number, _count: number, work: () => unknown) => work();
