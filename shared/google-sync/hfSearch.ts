import {
  downloadPlan,
  findExistingModelForVariant,
  repoPlan,
  resolveGgufResponse,
  searchPlan,
  searchResponse,
} from '../../src/local-llm/hfSearch';
import type { GgufVariant, HfSearchResult, LocalModelDefinition } from '../../src/local-llm/types';
import { sortSearchResults, type HfSearchUIQuery } from '../../src/local-llm/hfSearch';

type Input =
  | { operation: 'searchPlan'; query: HfSearchUIQuery }
  | { operation: 'searchResponse'; query: HfSearchUIQuery; data: unknown; link?: string | null }
  | { operation: 'sortResults'; results: HfSearchResult[]; sort: HfSearchUIQuery['sort']; sortDir?: 'asc' | 'desc' }
  | { operation: 'repoPlan'; repoID: string }
  | { operation: 'variants'; data: unknown }
  | { operation: 'downloadPlan'; result: HfSearchResult; variant: GgufVariant; totalBytes?: number }
  | { operation: 'existingModel'; repoID: string; fileName: string; models: LocalModelDefinition[] };

export function hfSearchOperation(json: string): string {
  const input = JSON.parse(json) as Input;
  switch (input.operation) {
    case 'searchPlan': return JSON.stringify(searchPlan(input.query));
    case 'searchResponse': return JSON.stringify(searchResponse(input.query, input.data, input.link ?? null));
    case 'sortResults': return JSON.stringify(sortSearchResults(input.results, input.sort, input.sortDir));
    case 'repoPlan': return JSON.stringify(repoPlan(input.repoID));
    case 'variants': return JSON.stringify(resolveGgufResponse(input.data));
    case 'downloadPlan': return JSON.stringify(downloadPlan(input.result, input.variant, input.totalBytes));
    case 'existingModel': return JSON.stringify(findExistingModelForVariant(input.repoID, input.fileName, input.models));
    default: throw new Error('Invalid Hugging Face search operation.');
  }
}
