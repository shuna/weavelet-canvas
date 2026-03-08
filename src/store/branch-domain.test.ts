import { describe, expect, it } from 'vitest';

import { _defaultChatConfig, _defaultImageDetail } from '@constants/chat';
import type { BranchClipboard, ChatInterface, ContentInterface } from '@type/chat';
import {
  createBranchState,
  deleteBranchState,
  ensureBranchTreeState,
  pasteBranchSequenceState,
} from './branch-domain';

const textContent = (text: string): ContentInterface[] => [{ type: 'text', text }];

const createChat = (): ChatInterface => ({
  id: 'chat-1',
  title: 'Chat',
  titleSet: true,
  config: { ..._defaultChatConfig },
  imageDetail: _defaultImageDetail,
  messages: [
    { role: 'user', content: textContent('hello') },
    { role: 'assistant', content: textContent('world') },
  ],
});

describe('branch-domain', () => {
  it('ensures branch tree state from flat messages', () => {
    const baseChat = createChat();
    const result = ensureBranchTreeState([baseChat], 0, {});

    expect(result.chats[0].branchTree).toBeDefined();
    expect(result.chats[0].branchTree?.activePath).toHaveLength(2);
    expect(Object.keys(result.contentStore)).toHaveLength(2);
  });

  it('creates and deletes a branch while maintaining content store refs', () => {
    const ensured = ensureBranchTreeState([createChat()], 0, {});
    const sourceNodeId = ensured.chats[0].branchTree!.activePath[1];

    const branched = createBranchState(
      ensured.chats,
      0,
      sourceNodeId,
      textContent('branch response'),
      ensured.contentStore
    );

    const newNodeId = branched.newId;
    const newHash = branched.chats[0].branchTree!.nodes[newNodeId].contentHash;
    expect(branched.contentStore[newHash]?.refCount).toBe(1);

    const deleted = deleteBranchState(
      branched.chats,
      0,
      newNodeId,
      branched.contentStore
    );

    expect(deleted.chats[0].branchTree?.nodes[newNodeId]).toBeUndefined();
    expect(deleted.contentStore[newHash]).toBeUndefined();
  });

  it('pastes copied nodes and retains referenced content', () => {
    const ensured = ensureBranchTreeState([createChat()], 0, {});
    const [firstNodeId, secondNodeId] = ensured.chats[0].branchTree!.activePath;
    const secondNode = ensured.chats[0].branchTree!.nodes[secondNodeId];

    const clipboard: BranchClipboard = {
      sourceChat: ensured.chats[0].id,
      nodeIds: [secondNodeId],
      nodes: {
        [secondNodeId]: { ...secondNode },
      },
    };

    const pasted = pasteBranchSequenceState(
      ensured.chats,
      0,
      firstNodeId,
      clipboard,
      ensured.contentStore
    );

    expect(pasted.chats[0].branchTree?.activePath).toHaveLength(2);
    expect(pasted.contentStore[secondNode.contentHash].refCount).toBe(2);
  });
});
