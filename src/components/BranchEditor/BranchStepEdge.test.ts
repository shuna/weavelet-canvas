import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Position } from 'reactflow';
import BranchStepEdge from './BranchStepEdge';

const viewport = vi.hoisted(() => ({ zoom: 1 }));
vi.mock('reactflow', async importOriginal => ({
  ...await importOriginal<typeof import('reactflow')>(),
  useStore: (select: (state: { transform: number[] }) => unknown) => select({ transform: [0, 0, viewport.zoom] }),
}));

describe('branch step edge', () => {
  it('keeps a visibly rounded route and compensates line widths only when zoomed out', () => {
    for (const zoom of [0.16, 1, 2]) {
      viewport.zoom = zoom;
      for (const width of [2, 4]) {
        const html = renderToStaticMarkup(React.createElement(BranchStepEdge, {
          id: 'edge', source: 'a', target: 'b', selected: false,
          sourceX: 0, sourceY: 0, targetX: 100, targetY: 180,
          sourcePosition: Position.Bottom, targetPosition: Position.Top,
          style: { stroke: '#3b82f6', strokeWidth: width, opacity: 0.65 },
        }));
        expect(html).toContain(`stroke-width:${width / Math.min(zoom, 1)}`);
        expect(html).toContain('stroke:#3b82f6');
        expect(html).toContain('opacity:0.65');
        expect(html).toContain('Q 0,90 32,90');
        expect(html).toContain('Q 100,90 100,122');
      }
    }
  });
});
