const record = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Only explicit JSON file imports accept the old iOS persistence/snapshot roots. */
export function normalizeLegacyIOSImport(data: unknown): unknown {
  if (!record(data)) return data;
  const snapshot = !Object.hasOwn(data, 'version') && Object.hasOwn(data, 'snapshotVersion');
  if (!snapshot && (data.version !== 1 || !Object.hasOwn(data, 'contentStore'))) return data;
  if (snapshot && (data.snapshotVersion !== 1 || typeof data.updatedAt !== 'number' || typeof data.deviceId !== 'string')) {
    throw new Error('Unsupported legacy iOS snapshot');
  }
  if (!Array.isArray(data.chats) || !record(data.contentStore) || !record(data.folders)) {
    throw new Error('Invalid legacy iOS import');
  }
  // Web V1/V2 inline branch nodes must still use their existing converters.
  const inline = data.chats.some(chat => record(chat?.branchTree?.nodes) &&
    Object.values(chat.branchTree.nodes).some(node => record(node) && Object.hasOwn(node, 'content')));
  if (inline && !snapshot) return data;
  const chats = data.chats.map(chat => {
    if (!record(chat) || !Array.isArray(chat.messages)) throw new Error('Invalid legacy iOS chat');
    if (chat.branchTree === undefined) return chat;
    const tree = chat.branchTree;
    if (!record(tree) || !record(tree.nodes) || typeof tree.rootId !== 'string' || !Array.isArray(tree.activePath)) {
      throw new Error('Invalid legacy iOS branch tree');
    }
    const nodes = Object.fromEntries(Object.entries(tree.nodes).map(([id, node]) => {
      if (!record(node) || typeof node.contentHash !== 'string' || Object.hasOwn(node, 'content')) {
        throw new Error('Invalid legacy iOS hashed node');
      }
      // Swift synthesized Codable omits nil parentId, while Web uses explicit null.
      return [id, Object.hasOwn(node, 'parentId') ? node : { ...node, parentId: null }];
    }));
    return { ...chat, branchTree: { ...tree, nodes } };
  });
  return { ...data, version: 3, chats };
}
