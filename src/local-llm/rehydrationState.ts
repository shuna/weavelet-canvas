let generation = 0;

export function localModelRehydrationGeneration(): number {
  return generation;
}

export function invalidateLocalModelRehydration(): void {
  generation += 1;
}
