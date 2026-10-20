import SwiftUI

struct BranchDiffRequest: Identifiable {
    enum Mode {
        case current(nodeID: String)
        case nodes(first: String, second: String)
    }
    let id = UUID()
    let key: BranchLayoutKey
    let mode: Mode
}

struct BranchComparison {
    struct Segment {
        let type: String
        let text: String
    }
    struct Row {
        let role: String
        let segments: [Segment]
        let textA: String
        let textB: String
    }
    let rows: [Row]
    let hasChanges: Bool

    static func compare(_ request: BranchDiffRequest) throws -> Self {
        guard let tree = request.key.tree, let rawStore = request.key.contentStore else {
            throw ExchangeError.invalid("分岐データがありません")
        }
        let pathA: [String], pathB: [String]
        switch request.mode {
        case .current(let nodeID):
            let path = try SharedWebOperations.call("branchPath", .object([
                .init(key: "tree", value: tree), .init(key: "nodeId", value: .string(nodeID))]))
            pathA = try path.array("path").map { try $0.string("node ID") }
            pathB = try tree.required("activePath").array("activePath").map { try $0.string("node ID") }
        case .nodes(let first, let second):
            let paths = try SharedWebOperations.call("branchNodeDiffPaths", .object([
                .init(key: "tree", value: tree), .init(key: "nodeIdA", value: .string(first)),
                .init(key: "nodeIdB", value: .string(second))]))
            pathA = try paths.required("pathA").array("pathA").map { try $0.string("node ID") }
            pathB = try paths.required("pathB").array("pathB").map { try $0.string("node ID") }
        }
        let nodes = try tree.required("nodes")
        var seen = Set<Data>()
        var entries: [JSONField] = []
        for nodeID in pathA + pathB {
            guard let node = nodes[nodeID] else { continue }
            let hash = try node.required("contentHash").string("contentHash")
            guard seen.insert(Data(hash.utf8)).inserted else { continue }
            entries.append(.init(key: hash, value: .object([
                .init(key: "content", value: try SyncRecords.resolveProjectedContent(rawStore, hash: hash)),
                .init(key: "refCount", value: .number("1"))
            ])))
        }
        let output = try SharedWebOperations.call("branchDiff", .object([
            .init(key: "tree", value: tree), .init(key: "contentStore", value: .object(entries)),
            .init(key: "pathA", value: .array(pathA.map(OrderedJSON.string))),
            .init(key: "pathB", value: .array(pathB.map(OrderedJSON.string)))
        ]))
        return try Self(rows: output.required("rows").array("rows").map { row in
            try Row(role: row.required("role").string("role"),
                segments: row.required("segments").array("segments").map { segment in
                    try Segment(type: segment.required("type").string("type"), text: segment.required("text").string("text"))
                }, textA: row.required("textA").string("textA"), textB: row.required("textB").string("textB"))
        }, hasChanges: output.required("hasChanges").boolean("hasChanges"))
    }
}

struct BranchDiffView: View {
    @ObservedObject var state: ChatState
    let request: BranchDiffRequest
    @Environment(\.dismiss) private var dismiss
    @State private var result: BranchComparison?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if !request.key.isCurrent(in: state) {
                    ContentUnavailableView("会話が変更されました", systemImage: "point.3.connected.trianglepath.dotted")
                } else if let result {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            if !result.hasChanges { Text("変更はありません").foregroundStyle(.secondary) }
                            ForEach(result.rows.indices, id: \.self) { index in
                                let row = result.rows[index]
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(row.role.capitalized).font(.caption.bold()).foregroundStyle(.secondary)
                                    Text("比較元の本文").font(.caption).foregroundStyle(.secondary)
                                    Text(row.textA).textSelection(.enabled)
                                    Text("比較先の本文").font(.caption).foregroundStyle(.secondary)
                                    Text(row.textB).textSelection(.enabled)
                                    Text("差分").font(.caption).foregroundStyle(.secondary)
                                    diffText(row.segments).textSelection(.enabled)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                            }
                        }
                        .padding()
                        .frame(maxWidth: 900)
                        .frame(maxWidth: .infinity)
                    }
                } else if let error {
                    ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
                } else {
                    ProgressView("差分を計算中")
                }
            }
            .nativeNavigationTitle("分岐を比較")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { dismiss() } } }
        }
        .task(id: request.id) {
            result = nil; error = nil
            do {
                let comparison = try await Task.detached(priority: .userInitiated) { try BranchComparison.compare(request) }.value
                guard !Task.isCancelled, request.key.isCurrent(in: state) else { return }
                result = comparison
            } catch {
                guard !Task.isCancelled, request.key.isCurrent(in: state) else { return }
                self.error = error.localizedDescription
            }
        }
    }

    private func diffText(_ segments: [BranchComparison.Segment]) -> Text {
        segments.reduce(Text("")) { text, segment in
            let part = Text(segment.text)
            switch segment.type {
            case "added": return text + part.foregroundColor(.green)
            case "removed": return text + part.foregroundColor(.red).strikethrough()
            default: return text + part
            }
        }
    }
}
