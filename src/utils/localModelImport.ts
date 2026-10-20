import type { LocalModelDefinition, LocalModelManifest, LocalModelTask } from '@src/local-llm/types';
import { parseShardInfo } from '@src/local-llm/ggufShardUtils';
export { ggufFingerprintPlan } from '@src/local-llm/modelFingerprint';

const sanitizeModelIdSegment = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'model';

export function singleGGUFDefinition(name: string, hash: string, size: number): LocalModelDefinition {
  return {
    id: `local-file--${hash.slice(0, 16)}--${sanitizeModelIdSegment(name)}`,
    engine: 'wllama',
    tasks: ['generation', 'analysis'],
    label: name,
    origin: name,
    source: 'opfs',
    manifest: {kind: 'single-file', entrypoint: name},
    fileSize: size,
    lastFileName: name,
  };
}

export type SelectedGGUFFile = {name: string; size: number};
export type SelectedGGUF = {
  files: SelectedGGUFFile[];
  manifest: LocalModelManifest;
  primaryName: string;
  displayLabel: string;
  totalSize: number;
};

export function inspectSelectedGGUFs(files: SelectedGGUFFile[]): SelectedGGUF {
  if (files.some((file) => !Number.isSafeInteger(file.size) || file.size < 0)) throw new Error('GGUF ファイルサイズが不正です。');
  if (new Set(files.map((file) => file.name)).size !== files.length) throw new Error('同じ GGUF ファイルが重複して選択されています。');
  const selectedFiles = [...files].sort((left, right) => left.name.localeCompare(right.name));
  if (selectedFiles.length === 0) throw new Error('GGUF ファイルを選択してください。');
  const shards = selectedFiles.map((file) => {
    const info = parseShardInfo(file.name);
    return {file, baseName: info?.baseName, current: info?.current, total: info?.total};
  });
  const isPossibleSet = selectedFiles.length > 1 && shards.every((shard) => shard.current !== undefined);
  if (isPossibleSet) {
    const baseNames = new Set(shards.map((shard) => shard.baseName));
    const totals = new Set(shards.map((shard) => shard.total));
    if (baseNames.size !== 1) throw new Error(`選択されたファイルは異なるモデルのシャードが混在しています（ベース名: ${[...baseNames].join(', ')}）。同じモデルの全シャードだけを選択してください。`);
    if (totals.size !== 1) throw new Error('選択されたファイルのシャード総数が一致しません。同じモデルの全シャードだけを選択してください。');
    const total = [...totals][0]!;
    if (selectedFiles.length !== total) throw new Error(`シャードセットが不完全です: ${total} 個中 ${selectedFiles.length} 個が選択されています。全 ${total} シャードをまとめて選択してください。`);
    const indices = new Set(shards.map((shard) => shard.current));
    for (let index = 1; index <= total; index++) {
      if (!indices.has(index)) throw new Error(`シャードセットに欠番があります（${index} 番目が見つかりません）。全 ${total} シャードをまとめて選択してください。`);
    }
    const ordered = shards.sort((left, right) => left.current! - right.current!).map((shard) => shard.file);
    const totalSize = ordered.reduce((sum, file) => sum + file.size, 0);
    if (!Number.isSafeInteger(totalSize)) throw new Error('GGUF ファイルサイズが不正です。');
    return {
      files: ordered,
      manifest: {kind: 'gguf-sharded', entrypoint: ordered[0].name, shards: ordered.map((file) => file.name), totalSize},
      primaryName: ordered[0].name,
      displayLabel: `${ordered[0].name} (${ordered.length} shards)`,
      totalSize,
    };
  }
  if (selectedFiles.length > 1) throw new Error('複数ファイルが選択されましたが、有効なシャードセットとして認識できません。単一の .gguf ファイル、または同一モデルの全シャードを選択してください。');
  const [file] = selectedFiles;
  return {files: [file], manifest: {kind: 'single-file', entrypoint: file.name}, primaryName: file.name, displayLabel: file.name, totalSize: file.size};
}

export function selectedGGUFDefinition(selection: SelectedGGUF, firstHash: string): LocalModelDefinition {
  if (selection.manifest.kind === 'single-file') return singleGGUFDefinition(selection.manifest.entrypoint, firstHash, selection.totalSize);
  const entrypoint = selection.manifest.entrypoint;
  return {
    id: `local-file--${firstHash.slice(0, 16)}--${sanitizeModelIdSegment(entrypoint)}`,
    engine: 'wllama', tasks: ['generation', 'analysis'], label: selection.displayLabel, origin: entrypoint, source: 'opfs',
    manifest: selection.manifest, fileSize: selection.totalSize, lastFileName: entrypoint,
  };
}

export type SelectedGGUFCandidate = {id: string; engine: string; kind: 'single-file' | 'gguf-sharded'; hashes: string[]; size?: number};
/** Matches stored fingerprint values; callers that can access both files must compare bytes before reuse. */
export function findSelectedGGUFDuplicate(selection: SelectedGGUF, files: Array<SelectedGGUFFile & {hash: string}>, candidates: SelectedGGUFCandidate[]): string | null {
  const kind = selection.manifest.kind;
  if (kind !== 'single-file' && kind !== 'gguf-sharded') return null;
  const byName = new Map(files.map((file) => [file.name,file]));
  const hashes = selection.files.map((file) => {
    const inspected = byName.get(file.name);
    if (!inspected || inspected.size !== file.size) throw new Error('GGUF ファイル情報が選択内容と一致しません。');
    return inspected.hash;
  });
  return candidates.find((candidate) =>
    candidate.engine === 'wllama'
      && candidate.kind === kind
      && (!candidate.size || candidate.size === selection.totalSize)
      && candidate.hashes.length === hashes.length
      && candidate.hashes.every((hash, index) => hash === hashes[index]),
  )?.id ?? null;
}

export function prepareSelectedGGUFImport(selection: SelectedGGUF, firstHash: string, existingModel?: LocalModelDefinition, existingIDs?: string[]) {
  const proposed = selectedGGUFDefinition(selection, firstHash);
  if (!existingModel && (existingIDs ?? []).includes(proposed.id)) throw new Error('A different model already uses this ID.');
  return {model: existingModel ?? proposed, existing: !!existingModel};
}

export function autoAssignImportedModel(active: Partial<Record<LocalModelTask, string>>, model: Pick<LocalModelDefinition, 'id' | 'tasks'>): Partial<Record<LocalModelTask, string>> {
  const next = {...active};
  for (const task of model.tasks) if (!next[task]) next[task] = model.id;
  return next;
}

export type SingleGGUFCandidate = {model: LocalModelDefinition; hash?: string; size?: number};
export function prepareSingleGGUFImport(name: string, hash: string, size: number, candidates: SingleGGUFCandidate[] = [], existingModel?: LocalModelDefinition, existingIDs?: string[]) {
  const proposed = singleGGUFDefinition(name, hash, size);
  const duplicate = existingModel ?? candidates.find(({model, hash: storedHash, size: storedSize}) =>
    model.engine === 'wllama' && model.manifest.kind === 'single-file' && storedHash === hash && (!storedSize || storedSize === size))?.model;
  if (!duplicate && (existingIDs ?? candidates.map(({model}) => model.id)).includes(proposed.id)) throw new Error('A different model already uses this ID.');
  return {model: duplicate ?? proposed, existing: !!duplicate};
}

export function commitSingleGGUFImport<T extends {localModels: LocalModelDefinition[]; activeLocalModels: Partial<Record<LocalModelTask, string>>}>(state: T, model: LocalModelDefinition, existingIDs?: string[]): T {
  const next = commitLocalModel(state, model, existingIDs);
  return {
    ...next,
    activeLocalModels: autoAssignImportedModel(next.activeLocalModels, model),
  };
}

export function commitSelectedGGUFImport<T extends {
  localModels: LocalModelDefinition[];
  activeLocalModels: Partial<Record<LocalModelTask, string>>;
  favoriteLocalModelIds: string[];
}>(state: T, model: LocalModelDefinition, existingIDs?: string[]): T {
  const next = commitSingleGGUFImport(state, model, existingIDs);
  return {
    ...next,
    favoriteLocalModelIds: next.favoriteLocalModelIds.includes(model.id)
      ? next.favoriteLocalModelIds
      : [...next.favoriteLocalModelIds, model.id],
  };
}

export function commitLocalModel<T extends {localModels: LocalModelDefinition[]}>(state: T, model: LocalModelDefinition, existingIDs?: string[]): T {
  const current = existingIDs ? existingIDs.includes(model.id) : state.localModels.some(entry => entry.id === model.id);
  return {
    ...state,
    localModels: current ? state.localModels : [...state.localModels, model],
  };
}

export function commitCatalogDuplicate<T extends {
  localModels: unknown[];
  activeLocalModels: Partial<Record<LocalModelTask, string>>;
  favoriteLocalModelIds: string[];
  savedModelMeta: Record<string, unknown>;
}>(state: T, downloadedID: string, duplicate: Pick<LocalModelDefinition, 'id' | 'tasks'>, localModelIDs?: string[]): T {
  const activeLocalModels = {...state.activeLocalModels};
  for (const task of Object.keys(activeLocalModels) as LocalModelTask[]) {
    if (activeLocalModels[task] === downloadedID) delete activeLocalModels[task];
  }
  const savedModelMeta = {...state.savedModelMeta};
  delete savedModelMeta[downloadedID];
  const favoriteLocalModelIds = state.favoriteLocalModelIds.filter((id) => id !== downloadedID);
  if (!favoriteLocalModelIds.includes(duplicate.id)) favoriteLocalModelIds.push(duplicate.id);
  return {
    ...state,
    localModels: state.localModels.filter((model, index) => {
      const id = localModelIDs?.[index] ?? (typeof model === 'object' && model !== null && 'id' in model && typeof model.id === 'string' ? model.id : undefined);
      return id !== downloadedID;
    }),
    activeLocalModels: autoAssignImportedModel(activeLocalModels, duplicate),
    favoriteLocalModelIds,
    savedModelMeta,
  };
}
