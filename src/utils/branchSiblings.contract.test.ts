import { describe, expect, it } from 'vitest';
import type { BranchTree } from '@type/chat';
import fixtures from '../../tests/fixtures/web-native/branch-siblings.json';
import { getSiblingsOf } from './branchUtils';

describe('branch siblings shared contract and Web observations', () => {
  for (const fixture of fixtures.cases) {
    it(`${fixture.scope}: ${fixture.name}`, () => {
      const tree: BranchTree = {
        rootId: 'unused-root',
        activePath: [],
        nodes: Object.fromEntries(
          fixture.nodes.map((node) => [node.id, {
            ...node,
            role: 'assistant' as const,
            contentHash: 'unused-content',
          }])
        ),
      };
      const before = structuredClone(tree);

      expect(getSiblingsOf(tree, fixture.nodeId).map((node) => node.id))
        .toEqual(fixture.expectedIds);
      expect(tree).toEqual(before);
    });
  }
});
