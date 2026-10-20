/**
 * Hugging Face Hub search module.
 *
 * Responsibilities:
 * - Search HF Hub API for models
 * - Classify repo-level support status
 * - Resolve GGUF variants within a repo
 * - Build ResolvedSearchCandidate from a selected variant
 * - Generate deterministic model IDs
 *
 * Public repos only. No authentication.
 */

import type {
  LocalModelEngine,
  LocalModelTask,
  LocalModelManifest,
  LocalModelDefinition,
  LocalModelDisplayMeta,
  HfSearchQuery,
  HfRepoFile,
  HfSearchResult,
  HfSearchResponse,
  HfSupportStatus,
  GgufVariant,
  GgufVariantStatus,
  GgufRepoResolution,
  ResolvedSearchCandidate,
} from './types';
import { formatBytes } from './device';
import { getManifestPrimaryFile, groupShardFiles, isShardGroupComplete } from './ggufShardUtils';
import { buildHfUrl } from './catalogPlan';
import { CURATED_MODELS } from './catalog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HF_API_BASE = 'https://huggingface.co/api/models';
// Size thresholds for variant classification
const SIZE_HEAVY =    1.5 * 1024 * 1024 * 1024;  // 1.5 GB — "heavy"
const SIZE_VERY_HEAVY = 4 * 1024 * 1024 * 1024;  // 4 GB — "very heavy"
const SIZE_EXTREME =   8 * 1024 * 1024 * 1024;    // 8 GB — "extreme"
const DEFAULT_LIMIT = 20;

// ---------------------------------------------------------------------------
// Quantization normalization
// ---------------------------------------------------------------------------

/** Known abbreviation expansions (lowercased, no separators) → normalized */
const QUANT_ABBREVIATIONS: Record<string, string> = {
  q2k: 'q2-k',
  q3km: 'q3-k-m',
  q3ks: 'q3-k-s',
  q3kl: 'q3-k-l',
  q4km: 'q4-k-m',
  q4ks: 'q4-k-s',
  q4kl: 'q4-k-l',
  q5km: 'q5-k-m',
  q5ks: 'q5-k-s',
  q5kl: 'q5-k-l',
  q6k: 'q6-k',
  q8k: 'q8-k',
  iq2xs: 'iq2-xs',
  iq2xxs: 'iq2-xxs',
  iq3xs: 'iq3-xs',
  iq3xxs: 'iq3-xxs',
  iq4xs: 'iq4-xs',
  iq4nl: 'iq4-nl',
};

/** Quantization priority for recommendation (lower = better) */
const QUANT_PRIORITY: Record<string, number> = {
  'q4-k-m': 1,
  'q4-0': 2,
  'q4-k-s': 3,
  'q5-k-m': 4,
  'q5-k-s': 5,
  'q3-k-m': 6,
  'q8-0': 7,
  'q6-k': 8,
};

/**
 * Extract raw quantization string from a GGUF filename.
 * Returns null if no quantization pattern found.
 */
function extractRawQuantization(fileName: string): string | null {
  // Match patterns like Q4_K_M, q4_0, Q8_0, IQ2_XS etc.
  const match = fileName.match(/[._-]((?:I?Q)\d[\w]*)/i);
  return match ? match[1] : null;
}

/**
 * Normalize a raw quantization string to a canonical form.
 * e.g. "Q4_K_M" → "q4-k-m", "Q4KM" → "q4-k-m"
 */
function normalizeQuantization(raw: string): string {
  // Lowercase, replace _ with -
  let norm = raw.toLowerCase().replace(/_/g, '-');

  // Check abbreviation table (strip separators for lookup)
  const stripped = norm.replace(/-/g, '');
  if (QUANT_ABBREVIATIONS[stripped]) {
    return QUANT_ABBREVIATIONS[stripped];
  }

  return norm;
}

/**
 * Sanitize a string for use in model IDs.
 * lowercase, non-[a-z0-9] → '-', collapse, trim
 */
function sanitizeIdSegment(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// HF API types (raw response shapes)
// ---------------------------------------------------------------------------

export interface HfApiModel {
  _id: string;
  id: string;              // "owner/repo"
  modelId?: string;
  author?: string;
  tags?: string[];
  pipeline_tag?: string;
  library_name?: string;
  downloads?: number;
  lastModified?: string;
  createdAt?: string;
  siblings?: Array<{ rfilename: string; size?: number }>;
  private?: boolean;
  gated?: boolean | string;
  description?: string;
  cardData?: { tags?: string[] };
}

export interface HfSearchPlan {
  url: string;
  parameters?: [string, string][];
  empty?: true;
}

export type HfSearchSort = HfSearchQuery['sort'] | 'size';
export type HfSearchUIQuery = Omit<HfSearchQuery, 'sort'> & { sort: HfSearchSort };

export interface HfDownloadModel {
  id: string;
  engine: LocalModelEngine;
  tasks: LocalModelTask[];
  label: string;
  huggingFaceRepo: string;
  revision: 'main';
  downloadFiles: string[];
  manifest: LocalModelManifest;
  expectedDownloadSize: number;
  displayMeta: LocalModelDisplayMeta;
}

export interface HfDownloadPlan {
  model: HfDownloadModel;
  files: { path: string; url: string }[];
  definition: LocalModelDefinition;
}

const repoSegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function requireRepoId(repoId: string): string {
  const parts = repoId.split('/');
  if (parts.length !== 2 || !parts.every((part) => repoSegment.test(part))) {
    throw new Error('Invalid Hugging Face repository ID.');
  }
  return repoId;
}

function requireFilePath(fileName: string): string {
  const parts = fileName.split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error('Invalid Hugging Face file path.');
  }
  return fileName;
}

// ---------------------------------------------------------------------------
// Repo-level support classification
// ---------------------------------------------------------------------------

function classifyRepoSupport(
  siblings: HfRepoFile[] | null,
  tags: string[],
  engine: LocalModelEngine | null,
): { status: HfSupportStatus; reason: string } {
  // Transformers.js: always needs-manual-review in initial implementation
  if (engine === 'transformers.js') {
    return {
      status: 'needs-manual-review',
      reason: 'Transformers.js repos require manual review in current version',
    };
  }

  if (!siblings) {
    // Search API doesn't return siblings — use tags for initial classification.
    // Detailed file validation is deferred to resolveGgufFiles().
    if (tags.includes('gguf')) {
      return { status: 'supported', reason: '' };
    }
    if (engine === 'wllama') {
      // Searched with GGUF filter but this repo may lack the tag — still try
      return { status: 'supported', reason: '' };
    }
    return {
      status: 'needs-manual-review',
      reason: 'No GGUF files detected. Only GGUF models are supported.',
    };
  }

  // Check for GGUF files
  const ggufFiles = siblings.filter(
    (s) => s.rfilename.endsWith('.gguf') && s.size > 0,
  );

  if (ggufFiles.length === 0) {
    return {
      status: 'unsupported',
      reason: 'No compatible model files found',
    };
  }

  // Accept any GGUF file: single-file or split shard sets are both supported.
  // Individual variant classification (size warnings, etc.) is done in resolveGgufFiles().
  return { status: 'supported', reason: '' };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Parse the Link header for the "next" URL.
 * Format: `<https://huggingface.co/api/models?...>; rel="next"`
 */
function parseLinkNext(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

export function searchPlan(query: HfSearchUIQuery): HfSearchPlan {
  const { query: text, engine, sort, sortDir = 'desc', limit = DEFAULT_LIMIT, nextUrl } = query;
  if (nextUrl) return { url: nextUrl };
  if (!text.trim()) return { url: HF_API_BASE, empty: true };

  const parameters: [string, string][] = [
    ['search', text],
    ['sort', sort === 'lastModified' ? 'lastModified' : 'downloads'],
    ['direction', sort !== 'size' && sortDir === 'asc' ? '1' : '-1'],
    ['limit', String(limit)],
  ];
  if (engine === 'wllama') parameters.push(['filter', 'gguf']);
  else if (engine === 'transformers.js') parameters.push(['library', 'transformers.js']);
  return { url: HF_API_BASE, parameters };
}

export function sortSearchResults(
  results: HfSearchResult[],
  sort: HfSearchSort,
  sortDir: 'asc' | 'desc' = 'desc',
): HfSearchResult[] {
  if (sort !== 'size') return results;
  return [...results].sort((left, right) => {
    const leftSize = left.bestCandidateSize ?? 0;
    const rightSize = right.bestCandidateSize ?? 0;
    return sortDir === 'asc' ? leftSize - rightSize : rightSize - leftSize;
  });
}

function resultForModel(model: HfApiModel, query: HfSearchUIQuery): HfSearchResult[] {
  const tags = Array.isArray(model.tags) ? model.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const siblings: HfRepoFile[] | null = Array.isArray(model.siblings)
    ? model.siblings
        .filter((s): s is { rfilename: string; size: number } =>
          typeof s.rfilename === 'string' && typeof s.size === 'number' && s.size > 0,
        )
        .map((s) => ({ rfilename: s.rfilename, size: s.size }))
    : null;

  let detectedEngine: LocalModelEngine | null = null;
  if (query.engine === 'wllama' || tags.includes('gguf')) detectedEngine = 'wllama';
  else if (query.engine === 'transformers.js' || model.library_name === 'transformers.js') detectedEngine = 'transformers.js';

  const { status, reason } = classifyRepoSupport(siblings, tags, detectedEngine);
  if (status !== 'supported') return [];

  let bestCandidateSize: number | null = null;
  if (siblings && detectedEngine === 'wllama') {
    const siblingsWithSize = siblings.map((s) => ({ rfilename: s.rfilename, size: s.size }));
    const shardGroups = groupShardFiles(siblingsWithSize.filter((s) => s.rfilename.endsWith('.gguf')));
    const shardedFileNames = new Set<string>();
    for (const group of shardGroups.values()) for (const file of group.files) shardedFileNames.add(file);
    const candidates: Array<{ name: string; size: number }> = [];
    for (const sibling of siblingsWithSize) {
      if (sibling.rfilename.endsWith('.gguf') && !shardedFileNames.has(sibling.rfilename)) {
        candidates.push({ name: sibling.rfilename, size: sibling.size });
      }
    }
    for (const [baseName, group] of shardGroups) candidates.push({ name: baseName, size: group.totalSize });
    candidates.sort((left, right) => {
      const leftQuant = extractRawQuantization(left.name);
      const rightQuant = extractRawQuantization(right.name);
      const leftPriority = leftQuant ? (QUANT_PRIORITY[normalizeQuantization(leftQuant)] ?? 99) : 99;
      const rightPriority = rightQuant ? (QUANT_PRIORITY[normalizeQuantization(rightQuant)] ?? 99) : 99;
      return leftPriority - rightPriority;
    });
    bestCandidateSize = candidates[0]?.size ?? null;
  }

  if (!model.id || !repoSegment.test(model.id.split('/')[0] ?? '') || !repoSegment.test(model.id.split('/')[1] ?? '') || model.id.split('/').length !== 2) {
    return [];
  }
  return [{
    repoId: model.id,
    repoUrl: `https://huggingface.co/${model.id}`,
    description: model.description ?? '',
    tags,
    downloads: model.downloads ?? 0,
    lastModified: model.lastModified ?? model.createdAt ?? '',
    bestCandidateSize,
    supportStatus: status,
    supportReason: reason,
    engine: detectedEngine,
  }];
}

export function searchResponse(query: HfSearchUIQuery, data: unknown, link: string | null): HfSearchResponse {
  if (!Array.isArray(data)) throw new Error('Invalid Hugging Face search response.');
  return {
    results: data.flatMap((model) => (
      model && typeof model === 'object' ? resultForModel(model as HfApiModel, query) : []
    )),
    nextPageUrl: parseLinkNext(link),
  };
}

export function repoPlan(repoId: string): { url: string } {
  return { url: `${HF_API_BASE}/${requireRepoId(repoId)}?blobs=true` };
}

/**
 * Search Hugging Face Hub for models.
 * Uses cursor-based pagination via the Link header.
 */
export async function searchHfModels(
  query: HfSearchUIQuery,
): Promise<HfSearchResponse> {
  const plan = searchPlan(query);
  if (plan.empty) return { results: [], nextPageUrl: null };
  const url = plan.parameters
    ? `${plan.url}?${new URLSearchParams(plan.parameters).toString()}`
    : plan.url;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'huggingface.co') {
    throw new Error('Invalid Hugging Face URL.');
  }
  const response = await fetch(parsed);
  if (!response.ok) throw new Error(`HF API: ${response.status}`);
  return searchResponse(query, await response.json(), response.headers.get('Link'));
}

// ---------------------------------------------------------------------------
// GGUF variant resolution
// ---------------------------------------------------------------------------

/**
 * Fetch repo details and resolve GGUF variants.
 * Returns null if fetch fails.
 */
export async function resolveGgufFiles(
  repoId: string,
): Promise<GgufRepoResolution | null> {
  let data: unknown;
  try {
    const plan = repoPlan(repoId);
    const url = new URL(plan.url);
    if (url.protocol !== 'https:' || url.hostname !== 'huggingface.co') return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    data = await response.json();
  } catch {
    return null;
  }

  return resolveGgufResponse(data);
}

export function resolveGgufResponse(data: unknown): GgufRepoResolution | null {
  if (!data || typeof data !== 'object') return null;
  const model = data as HfApiModel;

  if (!Array.isArray(model.siblings)) return null;

  const ggufSiblings = model.siblings.filter(
    (s) => typeof s.rfilename === 'string' && s.rfilename.endsWith('.gguf')
      // Exclude vision projector files (not runnable models)
      && !/mmproj/i.test(s.rfilename),
  );

  const variants: GgufVariant[] = [];

  // Group split GGUF files into shard sets.
  // Key: baseName (e.g. "model"), Value: { files: [...], totalSize }
  const shardGroups = groupShardFiles(
    ggufSiblings.map((s) => ({ rfilename: s.rfilename, size: typeof s.size === 'number' ? s.size : 0 })),
  );
  // Collect all filenames that belong to a shard group so we can skip them in the single-file loop
  const shardedFileNames = new Set<string>();
  for (const group of shardGroups.values()) {
    for (const f of group.files) shardedFileNames.add(f);
  }

  // Process single-file (non-sharded) GGUFs
  for (const sibling of ggufSiblings) {
    const rfilename = sibling.rfilename;
    const size = typeof sibling.size === 'number' ? sibling.size : 0;

    // Exclude: filename unparseable (empty or just extension)
    if (!rfilename || rfilename === '.gguf') continue;
    // Skip files that are part of a shard group — handled separately below
    if (shardedFileNames.has(rfilename)) continue;

    const rawQuant = extractRawQuantization(rfilename);
    const normalizedQuant = rawQuant
      ? normalizeQuantization(rawQuant)
      : sanitizeIdSegment(rfilename.replace(/\.gguf$/i, ''));

    // Determine per-variant support status
    let supportStatus: GgufVariantStatus = 'supported';
    let supportReason: string | undefined;

    if (size > 0 && size > SIZE_EXTREME) {
      supportStatus = 'not-recommended';
      supportReason = 'extreme';
    } else if (size > 0 && size > SIZE_VERY_HEAVY) {
      supportStatus = 'not-recommended';
      supportReason = 'very-heavy';
    } else if (size > 0 && size > SIZE_HEAVY) {
      supportStatus = 'not-recommended';
      supportReason = 'heavy';
    }

    const sizeStr = size > 0 ? formatBytes(size) : '?';
    const label = rawQuant
      ? `${normalizedQuant.toUpperCase()} — ${sizeStr}`
      : `${rfilename} — ${sizeStr}`;

    variants.push({
      fileName: rfilename,
      size,
      rawQuantization: rawQuant,
      normalizedQuantization: normalizedQuant,
      supportStatus,
      supportReason,
      label,
      recommended: false, // set below
    });
  }

  // Process shard groups — each complete group becomes a single variant
  for (const [baseName, group] of shardGroups) {
    const firstShard = group.files[0];
    if (!firstShard) continue;

    const rawQuant = extractRawQuantization(baseName);
    const normalizedQuant = rawQuant
      ? normalizeQuantization(rawQuant)
      : sanitizeIdSegment(baseName);

    // Incomplete groups (missing shards) are exposed as unsupported so the user
    // can see them but knows they cannot be downloaded as-is.
    if (!isShardGroupComplete(group)) {
      const shardLabel = `${group.files.length}/${group.expectedTotal} shards`;
      const sizeStr = group.totalSize > 0 ? formatBytes(group.totalSize) : '?';
      const label = rawQuant
        ? `${normalizedQuant.toUpperCase()} — ${sizeStr} (${shardLabel}, incomplete)`
        : `${baseName} — ${sizeStr} (${shardLabel}, incomplete)`;
      variants.push({
        fileName: firstShard,
        size: group.totalSize,
        rawQuantization: rawQuant,
        normalizedQuantization: normalizedQuant,
        supportStatus: 'unsupported',
        supportReason: `Incomplete shard set: ${group.files.length} of ${group.expectedTotal} shards found`,
        label,
        recommended: false,
        shardFiles: group.files,
      });
      continue;
    }

    const totalSize = group.totalSize;

    let supportStatus: GgufVariantStatus = 'supported';
    let supportReason: string | undefined;
    if (totalSize > 0 && totalSize > SIZE_EXTREME) {
      supportStatus = 'not-recommended';
      supportReason = 'extreme';
    } else if (totalSize > 0 && totalSize > SIZE_VERY_HEAVY) {
      supportStatus = 'not-recommended';
      supportReason = 'very-heavy';
    } else if (totalSize > 0 && totalSize > SIZE_HEAVY) {
      supportStatus = 'not-recommended';
      supportReason = 'heavy';
    }

    const sizeStr = totalSize > 0 ? formatBytes(totalSize) : '?';
    const shardLabel = `${group.files.length} shards`;
    const label = rawQuant
      ? `${normalizedQuant.toUpperCase()} — ${sizeStr} (${shardLabel})`
      : `${baseName} — ${sizeStr} (${shardLabel})`;

    variants.push({
      fileName: firstShard,
      size: totalSize,
      rawQuantization: rawQuant,
      normalizedQuantization: normalizedQuant,
      supportStatus,
      supportReason,
      label,
      recommended: false, // set below
      shardFiles: group.files,
    });
  }

  if (variants.length === 0) {
    return { variants: [], recommendedFile: null, lastModified: model.lastModified };
  }

  // Find best recommendation: prefer supported, fall back to not-recommended (lighter first)
  const supported = variants.filter((v) => v.supportStatus === 'supported');
  const candidates = supported.length > 0
    ? supported
    : variants.filter((v) => v.supportStatus === 'not-recommended');

  if (candidates.length === 1) {
    candidates[0].recommended = true;
  } else if (candidates.length > 1) {
    // Sort by quantization priority (lighter = better), then by size ascending
    const sorted = [...candidates].sort((a, b) => {
      const pa = QUANT_PRIORITY[a.normalizedQuantization] ?? 99;
      const pb = QUANT_PRIORITY[b.normalizedQuantization] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.size - b.size; // prefer smaller
    });
    const best = variants.find((v) => v.fileName === sorted[0].fileName);
    if (best) best.recommended = true;
  }

  const recommendedFile = variants.find((v) => v.recommended)?.fileName ?? null;

  // Sort variants: supported first (by priority), then not-recommended, then unsupported
  variants.sort((a, b) => {
    const statusOrder: Record<GgufVariantStatus, number> = {
      supported: 0,
      'not-recommended': 1,
      unsupported: 2,
    };
    const so = statusOrder[a.supportStatus] - statusOrder[b.supportStatus];
    if (so !== 0) return so;
    // Within same status, sort by quant priority
    const pa = QUANT_PRIORITY[a.normalizedQuantization] ?? 99;
    const pb = QUANT_PRIORITY[b.normalizedQuantization] ?? 99;
    return pa - pb;
  });

  return { variants, recommendedFile, lastModified: model.lastModified };
}

// ---------------------------------------------------------------------------
// Candidate resolution (variant-level)
// ---------------------------------------------------------------------------

/**
 * Build a ResolvedSearchCandidate from a search result and a selected variant.
 * Returns null if defensive checks fail.
 *
 * Only call for supported variants of supported repos.
 */
export function resolveSearchCandidate(
  result: HfSearchResult,
  variant: GgufVariant,
): ResolvedSearchCandidate | null {
  // Defensive checks
  if (!variant.fileName.endsWith('.gguf')) return null;
  if (result.engine !== 'wllama' && !result.tags.includes('gguf')) return null;

  // Build manifest: sharded or single-file
  const manifest: LocalModelManifest = variant.shardFiles && variant.shardFiles.length > 1
    ? {
        kind: 'gguf-sharded',
        entrypoint: variant.shardFiles[0],
        shards: variant.shardFiles,
        totalSize: variant.size,
      }
    : {
        kind: 'single-file',
        entrypoint: variant.fileName,
      };

  const tasks = guessTasksFromRepo(result.repoId, result.tags, variant.fileName);

  // Generate human-readable label
  const [, repoName] = result.repoId.split('/');
  const quantLabel = variant.rawQuantization
    ? variant.normalizedQuantization.toUpperCase()
    : variant.fileName.replace(/\.gguf$/i, '');
  const label = `${repoName ?? result.repoId} (${quantLabel})`;

  const displayMeta: LocalModelDisplayMeta = {
    supportsTextInference: true,
    quantization: variant.rawQuantization
      ? variant.normalizedQuantization.toUpperCase()
      : undefined,
    sourceLabel: 'search',
  };

  return {
    repoId: result.repoId,
    engine: 'wllama',
    label,
    manifest,
    // For sharded models, downloadFiles contains all shards; for single-file, just the one file.
    downloadFiles: variant.shardFiles && variant.shardFiles.length > 1
      ? variant.shardFiles
      : [variant.fileName],
    estimatedSize: variant.size,
    tasks,
    selectedFile: variant.fileName,
    displayMeta,
  };
}

export function downloadPlan(
  result: HfSearchResult,
  variant: GgufVariant,
  totalBytes?: number,
): HfDownloadPlan {
  requireRepoId(result.repoId);
  if (result.supportStatus !== 'supported' || (result.engine !== 'wllama' && !result.tags.includes('gguf'))) {
    throw new Error('Unsupported Hugging Face search result.');
  }
  if (variant.supportStatus === 'unsupported') throw new Error('Unsupported GGUF variant.');
  if (totalBytes !== undefined && (!Number.isFinite(totalBytes) || totalBytes < 0)) {
    throw new Error('Invalid Hugging Face download size.');
  }
  requireFilePath(variant.fileName);
  if (variant.shardFiles) {
    if (variant.shardFiles.length < 2 || new Set(variant.shardFiles).size !== variant.shardFiles.length) {
      throw new Error('Invalid GGUF shard files.');
    }
    variant.shardFiles.forEach((fileName) => {
      requireFilePath(fileName);
      if (!fileName.endsWith('.gguf')) throw new Error('Invalid GGUF shard file.');
    });
  }
  const candidate = resolveSearchCandidate(result, variant);
  if (!candidate) throw new Error('Unsupported Hugging Face search candidate.');
  const model: HfDownloadModel = {
    id: generateSearchModelId(result.repoId, variant),
    engine: candidate.engine,
    tasks: candidate.tasks,
    label: candidate.label,
    huggingFaceRepo: result.repoId,
    revision: 'main',
    downloadFiles: candidate.downloadFiles,
    manifest: candidate.manifest,
    expectedDownloadSize: candidate.estimatedSize,
    displayMeta: candidate.displayMeta,
  };
  return {
    model,
    files: model.downloadFiles.map((path) => ({ path, url: buildHfUrl(model.huggingFaceRepo, model.revision, path) })),
    definition: {
      id: model.id,
      engine: model.engine,
      tasks: model.tasks,
      label: model.label,
      origin: model.huggingFaceRepo,
      source: 'opfs',
      manifest: model.manifest,
      fileSize: totalBytes ?? model.expectedDownloadSize,
    },
  };
}

export function findExistingModelForVariant(
  repoId: string,
  fileName: string,
  models: LocalModelDefinition[],
): string | null {
  for (const model of CURATED_MODELS) {
    if (model.huggingFaceRepo === repoId && model.downloadFiles.includes(fileName)) return model.id;
  }
  for (const model of models) {
    if (model.origin === repoId && (model.manifest.kind === 'single-file' || model.manifest.kind === 'gguf-sharded') && getManifestPrimaryFile(model.manifest) === fileName) {
      return model.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Task heuristic
// ---------------------------------------------------------------------------

function guessTasksFromRepo(
  repoId: string,
  tags: string[],
  selectedFile?: string,
): LocalModelTask[] {
  const combined = [
    repoId.toLowerCase(),
    ...tags.map((t) => t.toLowerCase()),
    (selectedFile ?? '').toLowerCase(),
  ].join(' ');

  if (tags.some((t) => t === 'text-classification')) {
    return ['moderation'];
  }

  if (
    tags.some((t) => t === 'text-generation') ||
    combined.includes('instruct') ||
    combined.includes('chat')
  ) {
    return ['generation', 'analysis'];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Model ID generation (variant-level, deterministic)
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic model ID from a repo and variant.
 * Format: hf--{owner}--{repo}--{variantKey}
 */
export function generateSearchModelId(
  repoId: string,
  variant: GgufVariant,
): string {
  const parts = repoId.split('/');
  const owner = sanitizeIdSegment(parts[0] ?? 'unknown');
  const repo = sanitizeIdSegment(parts[1] ?? parts[0] ?? 'unknown');

  const variantKey = variant.rawQuantization
    ? variant.normalizedQuantization
    : sanitizeIdSegment(variant.fileName.replace(/\.gguf$/i, ''));

  return `hf--${owner}--${repo}--${variantKey}`;
}
