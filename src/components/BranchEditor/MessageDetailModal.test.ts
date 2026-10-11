import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@store/store', () => ({
  default: (select: (state: unknown) => unknown) => select({
    chats: [{ branchTree: { nodes: { message: { contentHash: 'content', role: 'user' } } } }],
    contentStore: { content: { content: [{ type: 'text', text: 'Branch detail' }] } },
    toggleNodeStar: vi.fn(),
    toggleNodePin: vi.fn(),
  }),
}));

import MessageDetailModal from './MessageDetailModal';

describe('branch message detail', () => {
  it('renders inside its branch canvas without a document-level portal', () => {
    const html = renderToStaticMarkup(React.createElement(MessageDetailModal, {
      chatIndex: 0, nodeId: 'message', onClose: vi.fn(),
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('absolute inset-0');
    expect(html).toContain('Branch detail');
    expect(html).not.toContain('fixed');
  });
});
