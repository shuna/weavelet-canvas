import Foundation

/// Status of a streaming request for recovery purposes.
enum StreamStatus: String, Codable {
    case streaming
    case completed
    case interrupted
    case failed
}

/// A record tracking an in-progress or recently-completed streaming request.
/// Persisted to disk so partial responses can be recovered after crashes.
struct StreamRecord: Codable, Identifiable {
    /// Unique request ID (UUID string).
    let id: String
    /// The chat this stream belongs to.
    let chatId: String
    /// The assistant branch node being streamed into.
    let nodeId: String
    /// Accumulated response text (replaced on each chunk, not appended).
    var bufferedText: String
    /// Current status of the stream.
    var status: StreamStatus
    /// When the stream request was created.
    var createdAt: Date
    /// When the buffered text was last updated (used for stale detection).
    var updatedAt: Date
}
