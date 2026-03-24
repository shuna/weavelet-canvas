# Weavelet Canvas — iOS (SwiftUI)

Web版 Weavelet Canvas のネイティブ iOS 移植。SwiftUI + Swift Package で構成。

## アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│  SwiftUI Views (app target)                     │
│  ChatListView, ConversationView, BranchEditor…  │
├─────────────────────────────────────────────────┤
│  ViewModels (@Observable)                       │
│  AppState, ChatListVM, ConversationVM, Settings │
├─────────────────────────────────────────────────┤
│  WeaveletInfra (Swift Package)                  │
│  ├─ ModelFetchService (URLSession, 10 providers)│
│  ├─ LLMClient (SSE streaming)                   │
│  ├─ ChatRepository (Codable + FileManager)       │
│  └─ DefaultProviders                             │
├─────────────────────────────────────────────────┤
│  WeaveletDomain (Swift Package, Foundation only) │
│  ├─ BranchTree (20+ operations)                 │
│  ├─ ContentStore (FNV-1a, delta, GC)            │
│  ├─ TokenBudget + CostCalculation               │
│  ├─ SSEParser + RequestBuilder                   │
│  └─ 全ドメイン型 (Chat, Message, BranchNode…)    │
└─────────────────────────────────────────────────┘
```

## ビルド要件

- Xcode 16+ (iOS 26 SDK)
- Swift 5.10+
- `ios/Weavelet-Canvas.xcworkspace` を開く

## テスト

```bash
cd ios/Packages/WeaveletDomain && swift test
# 142 tests passing
```

## 実装済み機能

### ドメイン層 (WeaveletDomain)
- [x] BranchTree 全操作 (作成/切替/削除/移動/プルーニング/コピー&ペースト)
- [x] ContentStore (FNV-1aハッシュ, デルタ圧縮, 参照カウント, GC)
- [x] TokenBudget + CostCalculation
- [x] SSEParser + RequestBuilder (Azure/OpenRouter対応)
- [x] 全ドメイン型 (Chat, Message, BranchNode, ContentItem, ProviderModel等)
- [x] Web互換 JSON エンコード/デコード (PersistedChat, ExportV3, SyncSnapshot)

### インフラ層 (WeaveletInfra)
- [x] ModelFetchService — 10プロバイダAPIからモデル一覧取得、能力自動検出
- [x] LLMClient — URLSession.bytes SSE ストリーミング、キャンセル対応
- [x] ChatRepository — Codable + FileManager (gzip圧縮、Web互換JSON)
- [x] DefaultProviders — 10社エンドポイント定義

### UI層 (SwiftUI)
- [x] アダプティブレイアウト (iPad 3カラム / iPhone サイドバー+タブ)
- [x] サイドバー: フォルダ(作成/色/展開/削除/並替), チャット(名前変更/クローン/エクスポート/編集モード/ソート)
- [x] メッセージバブル: ブランチスイッチャー, 編集/リジェネ/コピー/削除, 折りたたみ/省略/保護, 上下移動
- [x] チャット入力: ロールセレクタ, 画像添付, / スラッシュコマンド, 保存ボタン
- [x] モデルドロップダウン: お気に入りから選択, プロバイダ管理へ遷移
- [x] ConfigMenu: お気に入りモデル一覧, パラメータスライダー, 推論設定
- [x] プロバイダメニュー: モデル検索/ソート/フィルタ, 能力バッジ, お気に入りチェック
- [x] ブランチエディタ: ツリー可視化, 検索ハイライト, 比較ビュー, 詳細モーダル
- [x] エクスポート: V3 JSON, OpenAI, OpenRouter, Markdown, PNG, gzip, ブランチスコープ切替
- [x] インポート: V3 JSON ファイルピッカー + ContentStore マージ
- [x] トークン/コストバー, メッセージ別トークン表示
- [x] チャット内検索 (ChatFindBar)
- [x] iPadキーボードショートカット (Cmd+N/S/Z/F等)
- [x] デバッグパネル
- [x] サイドバーリサイズハンドル
- [x] オンボーディングウィザード (4ステップ)
- [x] ストリーミングインジケータ + エラーバナー

### 永続化
- [x] Codable + FileManager (Web互換JSON形式)
- [x] バックグラウンド移行時に自動保存, 起動時に自動読み込み
- [x] 設定: UserDefaults

### i18n
- [x] String Catalog (Localizable.xcstrings) — 英語 + 日本語, 45+キー

## 残課題 (優先度順)

### 高優先度
- [ ] **iCloud 同期** — CKSyncEngine + WeaveletSnapshot 互換形式 (Web版とデータ共有)
- [ ] **Google Drive 同期** — Web版と同形式で JSON アップロード/ダウンロード
- [ ] **バックグラウンドURLSession** — アプリ切替時のLLMストリーム継続 + Cloudflare Worker プロキシ復旧

### 中優先度
- [ ] **Keychain 移行** — APIキーを UserDefaults → Keychain (セキュリティ向上)
- [ ] **KaTeX/LaTeX レンダリング** — swift-markdown + 部分的WKWebView ハイブリッド
- [ ] **i18n 完全カバー** — 現在45キー → Web版200+キー分を追加
- [ ] **プロンプトインポート** — ファイルピッカーからのプロンプトJSONインポート

### 低優先度
- [ ] **V1レガシーエクスポート** — 下位互換形式
- [ ] **macOS対応** — ドメイン層はそのまま再利用可能、UI層をmacOS向けに拡張
- [ ] **watchOS対応** — ドメイン層再利用、簡易チャットUI

## ファイル構成

```
ios/
├── .gitignore
├── README.md                          ← このファイル
├── Weavelet-Canvas.xcworkspace/       ← Xcode ワークスペース
├── Weavelet-Canvas/
│   └── Weavelet-Canvas/
│       ├── Weavelet_CanvasApp.swift   ← エントリポイント
│       ├── Localizable.xcstrings      ← i18n String Catalog
│       ├── ViewModels/                ← @Observable ViewModels
│       │   ├── AppState.swift
│       │   ├── ChatListViewModel.swift
│       │   ├── ConversationViewModel.swift
│       │   └── SettingsViewModel.swift
│       └── Views/
│           ├── BranchEditor/          ← ブランチエディタ (6ファイル)
│           ├── Chat/                  ← チャットUI (7ファイル)
│           ├── Layout/                ← レイアウト (3ファイル)
│           ├── Markdown/              ← Markdownレンダラ (2ファイル)
│           ├── Onboarding/            ← ウィザード (1ファイル)
│           └── Settings/              ← 設定画面 (8ファイル)
├── Packages/
│   ├── WeaveletDomain/                ← ドメインロジック (142テスト)
│   │   ├── Sources/WeaveletDomain/
│   │   │   ├── API/                   ← SSEParser, RequestBuilder
│   │   │   ├── BranchTree/            ← ブランチツリー操作
│   │   │   ├── ContentStore/          ← コンテンツストア
│   │   │   ├── Models/                ← ドメイン型定義
│   │   │   └── TokenBudget/           ← トークン/コスト計算
│   │   └── Tests/
│   └── WeaveletInfra/                 ← インフラ層
│       ├── Sources/WeaveletInfra/
│       │   ├── Network/               ← ModelFetch, LLMClient, DefaultProviders
│       │   └── Persistence/           ← ChatRepository
│       └── Tests/
```
