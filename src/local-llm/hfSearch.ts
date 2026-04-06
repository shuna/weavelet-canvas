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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HF_API_BASE = 'https://huggingface.co/api/models';
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
// Split GGUF detection
// ---------------------------------------------------------------------------

const SPLIT_GGUF_PATTERN = /[-.](\d{2,}[-.]of[-.]?\d+|part\d+of\d+)/i;

function isSplitGguf(fileName: string): boolean {
  return SPLIT_GGUF_PATTERN.test(fileName);
}

// ---------------------------------------------------------------------------
// HF API types (raw response shapes)
// ---------------------------------------------------------------------------

interface HfApiModel {
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

  // Check if at least one non-split GGUF is within size limit
  const hasUsable = ggufFiles.some(
    (f) => !isSplitGguf(f.rfilename),
  );

  if (!hasUsable) {
    return {
      status: 'unsupported',
      reason: 'All GGUF files are too large or split',
    };
  }

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

/**
 * Search Hugging Face Hub for models.
 * Uses cursor-based pagination via the Link header.
 */
export async function searchHfModels(
  query: HfSearchQuery,
): Promise<HfSearchResponse> {
  const { query: q, engine, sort, sortDir = 'desc', limit = DEFAULT_LIMIT, nextUrl } = query;

  if (!q.trim() && !nextUrl) return { results: [], nextPageUrl: null };

  let fetchUrl: string;
  if (nextUrl) {
    fetchUrl = nextUrl;
  } else {
    const params = new URLSearchParams({
      search: q,
      sort: sort === 'lastModified' ? 'lastModified' : 'downloads',
      direction: sortDir === 'asc' ? '1' : '-1',
      limit: String(limit),
    });
    if (engine === 'wllama') {
      params.append('filter', 'gguf');
    } else if (engine === 'transformers.js') {
      params.append('library', 'transformers.js');
    }
    fetchUrl = `${HF_API_BASE}?${params.toString()}`;
  }

  let data: HfApiModel[];
  let nextPageUrl: string | null = null;
  try {
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`HF API: ${response.status}`);
    }
    data = await response.json();
    nextPageUrl = parseLinkNext(response.headers.get('Link'));
  } catch {
    return { results: [], nextPageUrl: null };
  }

  // Filter out non-supported repos entirely (no GGUF, unsupported formats, etc.)
  const results = data.flatMap((model): HfSearchResult[] => {
    const tags = model.tags ?? [];
    const siblings: HfRepoFile[] | null = model.siblings
      ? model.siblings
          .filter((s): s is { rfilename: string; size: number } =>
            typeof s.size === 'number' && s.size > 0,
          )
          .map((s) => ({ rfilename: s.rfilename, size: s.size }))
      : null;

    // Determine engine from context
    let detectedEngine: LocalModelEngine | null = null;
    if (engine === 'wllama' || tags.includes('gguf')) {
      detectedEngine = 'wllama';
    } else if (engine === 'transformers.js' || model.library_name === 'transformers.js') {
      detectedEngine = 'transformers.js';
    }

    const { status, reason } = classifyRepoSupport(siblings, tags, detectedEngine);

    // Drop unsupported and needs-manual-review repos from results
    if (status !== 'supported') return [];

    // Estimate best candidate size (recommended GGUF variant)
    let bestCandidateSize: number | null = null;
    if (siblings && detectedEngine === 'wllama') {
      const ggufFiles = siblings
        .filter((s) => s.rfilename.endsWith('.gguf') && !isSplitGguf(s.rfilename))
        .sort((a, b) => {
          const qa = extractRawQuantization(a.rfilename);
          const qb = extractRawQuantization(b.rfilename);
          const pa = qa ? (QUANT_PRIORITY[normalizeQuantization(qa)] ?? 99) : 99;
          const pb = qb ? (QUANT_PRIORITY[normalizeQuantization(qb)] ?? 99) : 99;
          return pa - pb;
        });
      if (ggufFiles.length > 0) {
        bestCandidateSize = ggufFiles[0].size;
      }
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
  });

  return { results, nextPageUrl };
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
  let data: HfApiModel;
  try {
    const response = await fetch(`${HF_API_BASE}/${repoId}?blobs=true`);
    if (!response.ok) return null;
    data = await response.json();
  } catch {
    return null;
  }

  if (!data.siblings) return null;

  const ggufSiblings = data.siblings.filter(
    (s) => s.rfilename.endsWith('.gguf')
      // Exclude vision projector files (not runnable models)
      && !/mmproj/i.test(s.rfilename),
  );

  const variants: GgufVariant[] = [];

  for (const sibling of ggufSiblings) {
    const rfilename = sibling.rfilename;
    const size = typeof sibling.size === 'number' ? sibling.size : 0;

    // Exclude: filename unparseable (empty or just extension)
    if (!rfilename || rfilename === '.gguf') continue;

    const rawQuant = extractRawQuantization(rfilename);
    const normalizedQuant = rawQuant
      ? normalizeQuantization(rawQuant)
      : sanitizeIdSegment(rfilename.replace(/\.gguf$/i, ''));

    // Determine per-variant support status
    let supportStatus: GgufVariantStatus = 'supported';
    let supportReason: string | undefined;

    if (isSplitGguf(rfilename)) {
      supportStatus = 'unsupported';
      supportReason = 'Split GGUF not supported';
    } else if (size > 0 && size > SIZE_EXTREME) {
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

  if (variants.length === 0) {
    return { variants: [], recommendedFile: null, lastModified: data.lastModified };
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

  return { variants, recommendedFile, lastModified: data.lastModified };
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
  // Only block split GGUF (structurally incompatible); size warnings are advisory
  if (variant.supportReason === 'Split GGUF not supported') return null;
  if (!variant.fileName.endsWith('.gguf')) return null;
  if (result.engine !== 'wllama' && !result.tags.includes('gguf')) return null;

  const manifest: LocalModelManifest = {
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
    downloadFiles: [variant.fileName],
    estimatedSize: variant.size,
    tasks,
    selectedFile: variant.fileName,
    displayMeta,
  };
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
