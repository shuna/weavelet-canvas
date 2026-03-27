import Foundation
import os

// MARK: - Branch Snapshot (minimal diff)

/// Stores only the target chat + content store entries that changed.
/// Undo/redo applies chat + contentStoreDiff as a set.
/// - Added/updated entries: stored with their full ContentEntry
/// - Deleted entries: stored with refCount = 0 (tombstone)
struct BranchSnapshot {
    let currentChatID: String
    let chat: Chat
    let contentStoreDiff: ContentStoreData  // only changed entries

    /// Estimated memory size for performance monitoring
    var estimatedSize: Int {
        let chatSize = chat.messages.count * 200  // rough estimate
        let storeSize = contentStoreDiff.count * 500
        return chatSize + storeSize
    }
}

// MARK: - BranchUndoManager

/// Manages undo/redo with minimal-diff snapshots.
/// Limit: 50 snapshots per stack.
class BranchUndoManager {

    private(set) var past: [BranchSnapshot] = []
    private(set) var future: [BranchSnapshot] = []

    static let historyLimit = 50

    private let logger = Logger(subsystem: "org.sstcr.WeaveletCanvas", category: "Undo")

    var canUndo: Bool { !past.isEmpty }
    var canRedo: Bool { !future.isEmpty }

    // MARK: - Push

    /// Push a snapshot before a mutation. Clears redo stack.
    /// Call this BEFORE applying the mutation to capture the "before" state.
    func push(
        currentChatID: String,
        chat: Chat,
        contentStore: ContentStoreData,
        previousContentStore: ContentStoreData
    ) {
        // Compute diff: entries that are in current but differ from previous
        let diff = computeDiff(current: contentStore, previous: previousContentStore)

        let snapshot = BranchSnapshot(
            currentChatID: currentChatID,
            chat: chat,
            contentStoreDiff: diff
        )

        past.append(snapshot)
        if past.count > Self.historyLimit {
            past.removeFirst()
        }
        future.removeAll()

        logger.debug("Push: past=\(self.past.count), snapshot=\(snapshot.estimatedSize)B")
    }

    // MARK: - Undo

    /// Undo: restore the last snapshot.
    /// Returns the snapshot to apply, or nil if nothing to undo.
    /// The caller must push a "current" snapshot to the redo stack before applying.
    func undo(
        currentChatID: String,
        currentChat: Chat,
        currentContentStore: ContentStoreData,
        previousContentStore: ContentStoreData
    ) -> BranchSnapshot? {
        guard let snapshot = past.popLast() else { return nil }

        // Push current state to future (redo)
        let diff = computeDiff(current: currentContentStore, previous: previousContentStore)
        future.append(BranchSnapshot(
            currentChatID: currentChatID,
            chat: currentChat,
            contentStoreDiff: diff
        ))

        logger.debug("Undo: past=\(self.past.count), future=\(self.future.count)")
        return snapshot
    }

    // MARK: - Redo

    /// Redo: restore the last undone snapshot.
    func redo(
        currentChatID: String,
        currentChat: Chat,
        currentContentStore: ContentStoreData,
        previousContentStore: ContentStoreData
    ) -> BranchSnapshot? {
        guard let snapshot = future.popLast() else { return nil }

        // Push current state to past (undo)
        let diff = computeDiff(current: currentContentStore, previous: previousContentStore)
        past.append(BranchSnapshot(
            currentChatID: currentChatID,
            chat: currentChat,
            contentStoreDiff: diff
        ))

        logger.debug("Redo: past=\(self.past.count), future=\(self.future.count)")
        return snapshot
    }

    // MARK: - Apply Snapshot

    /// Apply a snapshot to the current state.
    /// Returns the updated chats and content store.
    static func applySnapshot(
        _ snapshot: BranchSnapshot,
        chats: [Chat],
        contentStore: ContentStoreData
    ) -> (chats: [Chat], contentStore: ContentStoreData) {
        var updatedChats = chats
        var updatedStore = contentStore

        // Replace the target chat
        if let idx = updatedChats.firstIndex(where: { $0.id == snapshot.currentChatID }) {
            updatedChats[idx] = snapshot.chat
        }

        // Apply content store diff
        for (hash, entry) in snapshot.contentStoreDiff {
            if entry.refCount <= 0 {
                // Tombstone: remove
                updatedStore.removeValue(forKey: hash)
            } else {
                updatedStore[hash] = entry
            }
        }

        return (updatedChats, updatedStore)
    }

    // MARK: - Clear

    func clear() {
        past.removeAll()
        future.removeAll()
    }

    // MARK: - Private

    /// Compute the diff between current and previous content stores.
    /// Returns entries that were added, updated, or deleted (tombstone with refCount=0).
    private func computeDiff(
        current: ContentStoreData,
        previous: ContentStoreData
    ) -> ContentStoreData {
        var diff: ContentStoreData = [:]

        // Entries in current that differ from previous
        for (hash, entry) in current {
            if previous[hash] != entry {
                diff[hash] = entry
            }
        }

        // Entries deleted from previous (tombstones)
        for (hash, _) in previous where current[hash] == nil {
            diff[hash] = ContentEntry(content: [], refCount: 0)
        }

        return diff
    }
}
