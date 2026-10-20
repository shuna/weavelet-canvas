export class FakeDrive {
  supportsCompaction = true;
  next = 0; files = new Map(); events = [];
  constructor(notFound, capture) {
    this.notFound = notFound;
    if (capture) { this.next = capture.next; this.files = new Map(capture.files.map(file => [file.id, { metadata: file.metadata, bytes: new Uint8Array(file.bytes) }])); this.events = capture.events; }
  }
  async ids(count) { return Array.from({ length: count }, () => `fake${++this.next}`); }
  async folder(id, headerId) {
    const metadata = { id, name: 'FAKE TEST sync', mimeType: 'application/vnd.google-apps.folder', appProperties: { weaveletSync: '1', headerId } };
    this.files.set(id, { metadata, bytes: new Uint8Array() }); return metadata;
  }
  async metadata(id) { const file = this.files.get(id); if (!file) throw new this.notFound('FAKE 404'); return file.metadata; }
  async keyHeader(dataset) { return (await this.metadata(dataset)).appProperties.headerId; }
  async history(dataset) { return { commits: await this.commits(dataset), packs: await this.packs(dataset) }; }
  async put(id, dataset, kind, bytes) {
    const old = this.files.get(id); if (old) { if (Buffer.compare(Buffer.from(bytes), Buffer.from(old.bytes))) throw new Error('FAKE collision'); return; }
    const metadata = { id, mimeType: 'application/octet-stream', appProperties: { dataset, kind } };
    this.files.set(id, { metadata, bytes: bytes.slice() }); this.events.push({ fileId: id, file: metadata });
  }
  async read(id) { const file = this.files.get(id); if (!file) throw new this.notFound('FAKE 404'); return file.bytes.slice(); }
  async startToken() { return String(this.events.length); }
  async commits(dataset) { return [...this.files].filter(([, file]) => file.metadata.appProperties?.dataset === dataset && file.metadata.appProperties.kind === 'commit').map(([id]) => id); }
  async packs(dataset) { return [...this.files].filter(([, file]) => file.metadata.appProperties?.dataset === dataset && file.metadata.appProperties.kind === 'pack').map(([id]) => id); }
  async changes(token) { return { token: String(this.events.length), changes: this.events.slice(Number(token)).map(change => ({
    id: change.fileId, removed: change.removed || change.file?.trashed,
    dataset: change.file?.appProperties?.dataset, kind: change.file?.appProperties?.kind,
  })) }; }
  async remove(id) { if (this.files.delete(id)) this.events.push({ fileId: id, removed: true }); }
  capture() { return { next: this.next, files: [...this.files].map(([id, file]) => ({ id, metadata: file.metadata, bytes: Array.from(file.bytes) })), events: this.events }; }
}
