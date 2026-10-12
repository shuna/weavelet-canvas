// Generated exact Web helper extraction; do not edit.
export function readMessageAttributes(owner: BranchTree | BranchClipboard): MessageAttributesV1 | undefined {
  const value = owner.messageAttributesV1;
  if (!Object.hasOwn(owner, 'messageAttributesV1')) return undefined;
  if (!value || value.version !== 1 || !value.byNode || typeof value.byNode !== 'object' || Array.isArray(value.byNode) ||
      Object.keys(value).some(key => key !== 'version' && key !== 'byNode') ||
      Object.keys(value.byNode).some(id => !Object.hasOwn(owner.nodes, id)) ||
      Object.values(value.byNode).some(attributes => !attributes || typeof attributes !== 'object' || Array.isArray(attributes) || Object.hasOwn(attributes, 'role') || Object.hasOwn(attributes, 'content'))) {
    throw new Error('Unsupported message attributes namespace.');
  }
  return value;
}

export function deleteMessageAttributes(owner: BranchTree | BranchClipboard, nodeId: string) {
  const previous = readMessageAttributes(owner);
  if (!previous || !Object.hasOwn(previous.byNode, nodeId)) return;
  const byNode = { ...previous.byNode };
  delete byNode[nodeId];
  owner.messageAttributesV1 = { version: 1, byNode };
}
export function captureProjectedMessageAttributes(): never { throw new Error("Use native SyncRecords for projected message attributes"); }
