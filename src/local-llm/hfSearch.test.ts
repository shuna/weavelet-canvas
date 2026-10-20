import { describe, expect, it, vi } from 'vitest';
import { downloadPlan, findExistingModelForVariant, repoPlan, resolveGgufResponse, searchHfModels, searchPlan, searchResponse, sortSearchResults } from './hfSearch';
import { hfSearchOperation } from '../../shared/google-sync/hfSearch';

const query = { query: 'qwen', engine: 'wllama' as const, sort: 'downloads' as const };
const rawSearch = [{
  id: 'org/model-gguf', tags: ['gguf', 'text-generation'], downloads: 12,
  siblings: [{ rfilename: 'model-Q4_K_M.gguf', size: 24 }],
}];

describe('Hugging Face search plans', () => {
  it('keeps URL construction outside the pure request plan', () => {
    expect(searchPlan(query)).toEqual({
      url: 'https://huggingface.co/api/models',
      parameters: [['search', 'qwen'], ['sort', 'downloads'], ['direction', '-1'], ['limit', '20'], ['filter', 'gguf']],
    });
    expect(searchPlan({ ...query, nextUrl: 'https://huggingface.co/api/models?cursor=next' }))
      .toEqual({ url: 'https://huggingface.co/api/models?cursor=next' });
    expect(searchPlan({ ...query, sort: 'size', sortDir: 'asc' })).toMatchObject({ parameters: expect.arrayContaining([['sort', 'downloads'], ['direction', '-1']]) });
    expect(searchPlan({ ...query, query: '  ' })).toEqual({ url: 'https://huggingface.co/api/models', empty: true });
    expect(repoPlan('org/model-gguf')).toEqual({ url: 'https://huggingface.co/api/models/org/model-gguf?blobs=true' });
  });

  it('shares result classification and GGUF variant resolution', () => {
    const response = searchResponse(query, rawSearch, '<https://huggingface.co/api/models?cursor=next>; rel="next"');
    expect(response.results).toMatchObject([{ repoId: 'org/model-gguf', engine: 'wllama', bestCandidateSize: 24 }]);
    expect(response.nextPageUrl).toBe('https://huggingface.co/api/models?cursor=next');
    expect(sortSearchResults([
      { ...response.results[0], repoId: 'later', bestCandidateSize: 0 },
      { ...response.results[0], repoId: 'first', bestCandidateSize: null },
    ], 'size', 'asc').map((entry) => entry.repoId)).toEqual(['later', 'first']);
    expect(resolveGgufResponse(rawSearch[0])).toMatchObject({
      recommendedFile: 'model-Q4_K_M.gguf',
      variants: [{ fileName: 'model-Q4_K_M.gguf', recommended: true }],
    });
    expect(() => searchResponse(query, {}, null)).toThrow('Invalid Hugging Face search response.');
  });

  it('builds the same searched definition and permits heavy variants', () => {
    const result = searchResponse(query, rawSearch, null).results[0];
    const variant = {
      fileName: 'model-Q4_K_M.gguf', size: 9_000_000_000, rawQuantization: 'Q4_K_M', normalizedQuantization: 'q4-k-m',
      supportStatus: 'not-recommended' as const, supportReason: 'extreme', label: 'Q4-K-M', recommended: false,
    };
    const plan = downloadPlan(result, variant, 42);
    expect(plan).toMatchObject({
      model: { id: 'hf--org--model-gguf--q4-k-m', revision: 'main', downloadFiles: ['model-Q4_K_M.gguf'] },
      files: [{ path: 'model-Q4_K_M.gguf', url: 'https://huggingface.co/org/model-gguf/resolve/main/model-Q4_K_M.gguf' }],
      definition: { id: 'hf--org--model-gguf--q4-k-m', source: 'opfs', fileSize: 42 },
    });
    expect(() => downloadPlan(result, { ...variant, supportStatus: 'unsupported' })).toThrow('Unsupported GGUF variant.');
  });

  it('keeps encoded traversal and URL punctuation inside a file path segment', () => {
    const result = searchResponse(query, rawSearch, null).results[0];
    const plan = downloadPlan(result, {
      fileName: '%2e%2e/model#?%.gguf', size: 1, rawQuantization: null, normalizedQuantization: 'model',
      supportStatus: 'supported', label: 'model', recommended: false,
    });
    expect(plan.files[0].url).toBe('https://huggingface.co/org/model-gguf/resolve/main/%252e%252e/model%23%3F%25.gguf');
  });

  it('exposes the pure operations to native callers', () => {
    expect(JSON.parse(hfSearchOperation(JSON.stringify({ operation: 'searchResponse', query, data: rawSearch, link: null }))))
      .toMatchObject({ results: [{ repoId: 'org/model-gguf' }], nextPageUrl: null });
    expect(findExistingModelForVariant('bartowski/Qwen_Qwen3-0.6B-GGUF', 'Qwen_Qwen3-0.6B-Q4_K_M.gguf', [{
      id: 'custom', engine: 'wllama', tasks: [], label: 'custom', origin: 'bartowski/Qwen_Qwen3-0.6B-GGUF', source: 'opfs',
      manifest: { kind: 'single-file', entrypoint: 'Qwen_Qwen3-0.6B-Q4_K_M.gguf' },
    }])).toBe('qwen3-0.6b-q4km');
    expect(findExistingModelForVariant('org/model-gguf', 'model-Q4_K_M.gguf', [{
      id: 'custom', engine: 'wllama', tasks: [], label: 'custom', origin: 'org/model-gguf', source: 'opfs',
      manifest: { kind: 'single-file', entrypoint: 'model-Q4_K_M.gguf' },
    }])).toBe('custom');
  });

  it('does not turn an HTTP failure into an empty successful result', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(searchHfModels(query)).rejects.toThrow('HF API: 503');
    vi.unstubAllGlobals();
  });
});
