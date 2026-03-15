# SwiftUI ネイティブアプリ移植検討

## 概要

Weavelet Canvas（React + TypeScript + Electron）を SwiftUI ベースのネイティブ macOS/iOS アプリへ移植する際の技術的検討をまとめる。

---

## 1. 現行アーキテクチャの整理

| レイヤー | 現行技術 | 主要ファイル |
|---------|---------|-------------|
| UI フレームワーク | React 18 + Tailwind CSS | `src/components/` |
| 状態管理 | Zustand (8 スライス構成) | `src/store/store.ts` |
| データモデル | TypeScript interfaces | `src/types/chat.ts` |
| API 通信 | fetch + ReadableStream (SSE) | `src/api/api.ts` |
| ブランチロジック | カスタム DAG 操作 | `src/store/branch-domain.ts` |
| コンテンツ重複排除 | ContentStore (FNV-1a ハッシュ) | `src/utils/contentStore.ts` |
| 永続化 | lz-string 圧縮 + localStorage | `src/store/persistence.ts` |
| ブランチエディタ | ReactFlow + Dagre + Web Worker | `src/components/BranchEditor/` |
| デスクトップ | Electron 23 | `electron/index.cjs` |
| 国際化 | i18next (19 言語) | `src/i18n.ts` |

---

## 2. SwiftUI 移植における技術マッピング

### 2.1 状態管理

| React (Zustand) | SwiftUI | 備考 |
|-----------------|---------|------|
| `useStore()` | `@Observable` (Swift 5.9+) | Observation フレームワーク推奨 |
| スライス分割 | `@Observable class` × N | ChatManager, BranchManager 等 |
| `persist` ミドルウェア | `Codable` + FileManager | 後述の永続化戦略参照 |
| `subscribeWithSelector` | Combine `Publisher` / onChange | 選択的監視 |

**推奨構成:**

```swift
@Observable
class AppState {
    var chatManager = ChatManager()
    var branchManager = BranchManager()
    var configManager = ConfigManager()
    var providerManager = ProviderManager()
    var contentStore = ContentStore()
}
```

### 2.2 データモデル

TypeScript → Swift の型変換は比較的ストレートフォワード:

```swift
enum Role: String, Codable { case user, assistant, system }

enum ContentPart: Codable {
    case text(String)
    case imageUrl(url: String, detail: ImageDetail)
}

struct MessageData: Codable, Identifiable {
    let id: String
    let role: Role
    let content: [ContentPart]
}

struct BranchNode: Codable, Identifiable {
    let id: String
    let parentId: String?
    let role: Role
    let contentHash: String
    let createdAt: Date
    var label: String?
}

struct BranchTree: Codable {
    var nodes: [String: BranchNode]
    var rootId: String
    var activePath: [String]
}

struct Chat: Codable, Identifiable {
    let id: String
    var title: String
    var folder: String?
    var messages: [MessageData]
    var config: ChatConfig
    var branchTree: BranchTree?
}
```

**難易度: 低** — 型定義の移植は機械的に行える。

### 2.3 API 通信 (ストリーミング)

| 現行 | SwiftUI ネイティブ |
|-----|------------------|
| `fetch()` | `URLSession` |
| `ReadableStream` (SSE) | `URLSession.bytes(from:)` + `AsyncStream` |
| `AbortController` | `Task.cancel()` |
| `TextDecoder` | `String(data:encoding:)` |

```swift
func streamChatCompletion(
    endpoint: URL,
    messages: [MessageData],
    config: ChatConfig,
    apiKey: String
) -> AsyncThrowingStream<StreamDelta, Error> {
    AsyncThrowingStream { continuation in
        let task = Task {
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONEncoder().encode(requestBody)

            let (bytes, response) = try await URLSession.shared.bytes(from: request)
            for try await line in bytes.lines {
                guard line.hasPrefix("data: ") else { continue }
                let json = String(line.dropFirst(6))
                if json == "[DONE]" { break }
                if let delta = parseStreamDelta(json) {
                    continuation.yield(delta)
                }
            }
            continuation.finish()
        }
        continuation.onTermination = { _ in task.cancel() }
    }
}
```

**難易度: 中** — AsyncStream パターンの理解が必要だが、概念的には同等。

### 2.4 ブランチエディタ (最大の課題)

現行の ReactFlow ベース DAG ビジュアライゼーションは **最も移植困難なコンポーネント**。

**選択肢:**

| アプローチ | メリット | デメリット |
|-----------|---------|-----------|
| **A. SwiftUI Canvas** | ネイティブ、軽量 | 大規模グラフでの性能要検証 |
| **B. SpriteKit** | 高性能レンダリング、ジェスチャ対応 | 学習コスト、SwiftUI 統合の手間 |
| **C. Metal + カスタム描画** | 最高性能 | 実装コスト極大 |
| **D. WebView 埋め込み** | 既存コード再利用 | ネイティブ感喪失、パフォーマンス問題 |

**推奨: A (SwiftUI Canvas) をベースに、パフォーマンス問題が出た場合 B に移行。**

レイアウト計算:
- 現行は Dagre ライブラリ + Web Worker でオフロード
- Swift では独自の階層レイアウトアルゴリズムを実装し、`Task.detached` で背景計算
- あるいは GameplayKit の `GKGraphNode` を活用

```swift
struct BranchEditorView: View {
    @State var viewModel: BranchEditorViewModel
    @State var scale: CGFloat = 1.0
    @State var offset: CGSize = .zero

    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                // エッジ描画
                for edge in viewModel.edges {
                    var path = Path()
                    path.move(to: edge.from)
                    path.addCurve(to: edge.to, ...)
                    context.stroke(path, with: .color(.gray))
                }
            }
            .overlay {
                // ノードオーバーレイ
                ForEach(viewModel.visibleNodes) { node in
                    BranchNodeView(node: node)
                        .position(node.position)
                        .contextMenu { nodeContextMenu(node) }
                }
            }
            .gesture(magnification.simultaneously(with: drag))
        }
    }
}
```

**難易度: 極めて高い** — グラフレイアウト・ジェスチャ・パフォーマンス最適化に相当の工数。

### 2.5 永続化

| 現行 | SwiftUI ネイティブ |
|-----|------------------|
| localStorage + lz-string | FileManager + `Codable` JSON |
| IndexedDB フォールバック | Core Data / SwiftData |
| Google Drive 同期 | Google Drive API (Swift SDK) / CloudKit |
| スキーマ v0-v15 マイグレーション | `Codable` + バージョン付きデコード |

**推奨アプローチ:**

```
┌─────────────────────────────────────────────┐
│           PersistenceManager                │
├─────────────────────────────────────────────┤
│ ┌──────────┐  ┌───────────┐  ┌───────────┐ │
│ │ JSON File│  │ SwiftData │  │ CloudKit  │ │
│ │ (チャット) │  │ (検索/索引)│  │ (同期)    │ │
│ └──────────┘  └───────────┘  └───────────┘ │
└─────────────────────────────────────────────┘
```

- **チャットデータ**: JSON ファイル (Documents ディレクトリ) — 既存フォーマットとの互換性維持
- **検索・インデックス**: SwiftData で高速クエリ対応
- **クラウド同期**: CloudKit (Apple エコシステム) または Google Drive API 継続
- **マイグレーション**: `CodingKeys` + カスタム `init(from:)` でバージョン対応

**難易度: 中〜高** — 16バージョンのマイグレーション移植が主な工数。

### 2.6 コンテンツ重複排除 (ContentStore)

現行の FNV-1a ハッシュベース ContentStore は Swift で忠実に再実装可能:

```swift
@Observable
class ContentStore {
    private var entries: [String: ContentEntry] = [:]

    struct ContentEntry: Codable {
        let content: [ContentPart]
        var refCount: Int
    }

    func add(_ content: [ContentPart]) -> String {
        let hash = computeHash(content)
        if let existing = entries[hash] {
            entries[hash]!.refCount += 1
        } else {
            entries[hash] = ContentEntry(content: content, refCount: 1)
        }
        return hash
    }

    func release(_ hash: String) {
        guard var entry = entries[hash] else { return }
        entry.refCount -= 1
        if entry.refCount <= 0 {
            entries.removeValue(forKey: hash)
        } else {
            entries[hash] = entry
        }
    }

    func resolve(_ hash: String) -> [ContentPart]? {
        entries[hash]?.content
    }

    private func computeHash(_ content: [ContentPart]) -> String {
        let data = try! JSONEncoder().encode(content)
        // FNV-1a ハッシュ
        var hash: UInt32 = 0x811c9dc5
        for byte in data {
            hash ^= UInt32(byte)
            hash &*= 0x01000193
        }
        return String(hash, radix: 16)
    }
}
```

**難易度: 低** — ロジックは単純で移植容易。

### 2.7 国際化

| 現行 | SwiftUI |
|-----|---------|
| i18next + JSON ファイル | `String(localized:)` + `.strings` / `.xcstrings` |
| 19 言語 | Xcode ローカライゼーションカタログ |

- 既存の JSON ファイルをスクリプトで `.xcstrings` に変換可能
- SwiftUI の `LocalizedStringKey` でネイティブ対応
- 動的言語切り替えは `@AppStorage("language")` + Environment で実現

**難易度: 低** — ツールによる自動変換が可能。

---

## 3. 対象プラットフォームと最小要件

| プラットフォーム | 最小バージョン | 理由 |
|---------------|-------------|------|
| **macOS** | 14.0 (Sonoma) | `@Observable` マクロ、SwiftData |
| **iOS** | 17.0 | 同上 |
| **iPadOS** | 17.0 | Split View でのブランチエディタ活用 |
| **visionOS** | 1.0 | 将来拡張（空間コンピューティング） |

Swift 5.9+ / Xcode 15+ を前提とする。

---

## 4. フェーズ別実装計画

### Phase 1: 基盤構築 (推定 4-6 週)

| タスク | 難易度 | 依存 |
|-------|-------|------|
| Swift Package 構成 (SPM) | 低 | — |
| データモデル定義 (`Codable`) | 低 | — |
| ContentStore 実装 | 低 | データモデル |
| 永続化レイヤー (JSON + FileManager) | 中 | データモデル |
| 基本 API クライアント (非ストリーミング) | 中 | データモデル |
| AppState / ObservableObject 構成 | 中 | 全モデル |

### Phase 2: コア機能 (推定 6-8 週)

| タスク | 難易度 | 依存 |
|-------|-------|------|
| チャットリスト UI | 低 | Phase 1 |
| チャットビュー (メッセージ表示) | 中 | Phase 1 |
| メッセージ入力 + 送信 | 中 | API クライアント |
| ストリーミングレスポンス | 高 | API クライアント |
| ブランチドメインロジック (branch-domain 移植) | 高 | ContentStore |
| メッセージ編集 + 再生成 | 中 | ブランチロジック |
| フォルダ管理 | 低 | AppState |
| Markdown + コードハイライト表示 | 中 | — |

### Phase 3: 高度な機能 (推定 8-12 週)

| タスク | 難易度 | 依存 |
|-------|-------|------|
| ブランチエディタ (DAG ビジュアライゼーション) | 極高 | Phase 2 |
| グラフレイアウトアルゴリズム | 高 | — |
| ブランチ差分ビューア | 中 | ブランチエディタ |
| インポート/エクスポート | 中 | データモデル |
| マルチプロバイダー対応 | 中 | API クライアント |
| Google Drive / CloudKit 同期 | 高 | 永続化 |
| 設定画面 | 低 | AppState |
| 多言語対応 | 低 | — |

### Phase 4: 仕上げ (推定 4-6 週)

| タスク | 難易度 | 依存 |
|-------|-------|------|
| macOS メニューバー統合 | 低 | — |
| キーボードショートカット | 低 | — |
| iPad Split View 最適化 | 中 | Phase 3 |
| パフォーマンスチューニング | 中 | 全体 |
| アクセシビリティ (VoiceOver) | 中 | UI 完成後 |
| テスト (XCTest + UI テスト) | 中 | 全体 |
| App Store 申請準備 | 低 | 全体 |

**合計見積: 22-32 週 (1 名フルタイム)**

---

## 5. メリットとリスク

### メリット

| 項目 | 詳細 |
|-----|------|
| **パフォーマンス** | ネイティブ描画による高速 UI、特にブランチエディタ |
| **メモリ効率** | Web ランタイム (V8/Blink) 不要、メモリ使用量 1/3〜1/5 |
| **OS 統合** | Spotlight 検索、共有シート、ウィジェット、Shortcuts |
| **セキュリティ** | Keychain による API キー管理 (localStorage より安全) |
| **バッテリー** | Electron 比で大幅改善 |
| **配信** | App Store / TestFlight での配信・アップデート |
| **visionOS** | 将来的な空間コンピューティング対応 |

### リスク

| リスク | 影響度 | 対策 |
|-------|-------|------|
| ブランチエディタの再実装コスト | 高 | Phase 3 で集中対応、MVP では簡易版で妥協 |
| ReactFlow 相当の SwiftUI ライブラリ不在 | 高 | カスタム実装が必要、OSSライブラリ調査 |
| 16 バージョンのマイグレーション移植 | 中 | 最新スキーマのみ対応し、旧バージョンは Web 版で変換 |
| マルチプラットフォーム (macOS + iOS) の UI 分岐 | 中 | `#if os(macOS)` で最小限の分岐 |
| Electron 版との機能パリティ維持 | 中 | 段階的移行、Web 版は当面維持 |
| ストリーミング SSE の iOS バックグラウンド制約 | 中 | `BGProcessingTask` で対応 |

---

## 6. 代替案の比較

| アプローチ | 工数 | ネイティブ感 | 保守性 |
|-----------|-----|------------|-------|
| **A. フル SwiftUI 書き直し** (本案) | 大 | 最高 | 高 |
| **B. Tauri (Rust + WebView)** | 小 | 低 | 中 |
| **C. React Native** | 中 | 中 | 中 (ブリッジコスト) |
| **D. Capacitor (Ionic)** | 小 | 低 | 中 |
| **E. Kotlin Multiplatform + SwiftUI** | 中 | 高 | 高 (ロジック共有) |

**B〜D は WebView ベースのためブランチエディタの性能問題を根本解決できない。**
**E は有力な代替案だが、Kotlin Multiplatform の学習コストを考慮する必要がある。**

---

## 7. 推奨アクション

1. **MVP スコープの定義**: ブランチエディタを除いた基本チャット機能で MVP を構築
2. **プロトタイプ**: Phase 1 を 2-3 週で実装し、SwiftUI の適合性を検証
3. **ブランチエディタ PoC**: SwiftUI Canvas でのグラフ描画性能を早期検証
4. **データ互換性**: 既存 Web 版とのデータインポート/エクスポート互換を確保
5. **段階的移行**: Web 版 (Electron) は当面維持し、並行開発

---

## 8. プロジェクト構成案

```
WeaveletCanvas/
├── Package.swift
├── Sources/
│   ├── App/
│   │   ├── WeaveletCanvasApp.swift
│   │   └── AppState.swift
│   ├── Models/
│   │   ├── Chat.swift
│   │   ├── Message.swift
│   │   ├── BranchTree.swift
│   │   ├── BranchNode.swift
│   │   ├── Provider.swift
│   │   └── ChatConfig.swift
│   ├── Store/
│   │   ├── ChatManager.swift
│   │   ├── BranchManager.swift
│   │   ├── ContentStore.swift
│   │   ├── ConfigManager.swift
│   │   └── ProviderManager.swift
│   ├── Services/
│   │   ├── APIClient.swift
│   │   ├── StreamingClient.swift
│   │   ├── PersistenceManager.swift
│   │   ├── MigrationService.swift
│   │   └── CloudSyncService.swift
│   ├── Views/
│   │   ├── ChatList/
│   │   │   ├── ChatListView.swift
│   │   │   ├── ChatRowView.swift
│   │   │   └── FolderView.swift
│   │   ├── Chat/
│   │   │   ├── ChatView.swift
│   │   │   ├── MessageView.swift
│   │   │   ├── MessageInputView.swift
│   │   │   └── MarkdownContentView.swift
│   │   ├── BranchEditor/
│   │   │   ├── BranchEditorView.swift
│   │   │   ├── BranchCanvasView.swift
│   │   │   ├── BranchNodeView.swift
│   │   │   ├── BranchLayoutEngine.swift
│   │   │   └── BranchDiffView.swift
│   │   ├── Settings/
│   │   │   ├── SettingsView.swift
│   │   │   ├── ProviderSettingsView.swift
│   │   │   └── ModelSettingsView.swift
│   │   └── Shared/
│   │       ├── CodeBlockView.swift
│   │       └── LaTeXView.swift
│   ├── Layout/
│   │   └── HierarchicalLayoutEngine.swift
│   └── Utils/
│       ├── FNVHash.swift
│       ├── TokenCounter.swift
│       └── ImportExportService.swift
├── Tests/
│   ├── ModelTests/
│   ├── StoreTests/
│   └── ServiceTests/
└── Resources/
    └── Localizable.xcstrings
```

---

*作成日: 2025-03-15*
*対象プロジェクト: Weavelet Canvas v1.27.0*
