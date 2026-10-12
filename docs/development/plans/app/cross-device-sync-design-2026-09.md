# 端末間同期の調査と設計（2026-09-29）

## 結論

Web を Windows / macOS / iPhone / Android の共通クライアントとする場合、**iCloud（CloudKit）と Google Drive は保存先として使えるが、現在の「単一の全量スナップショットを上書きする」方式のままでは安全な端末間同期にはならない**。保存先の競合検出と、会話内容の競合解決は別問題である。

自前サーバーにユーザーデータを置かない方針なら、まず既存の CloudKit と Google Drive を対象に、アプリ共通の同期プロトコルを作る。認証頻度を最優先する場合は、ブラウザだけで PKCE と更新トークンを扱える Dropbox App Folder を第三候補として小さく検証する。ただし更新トークンをブラウザに保持するセキュリティ上の負担が増えるため、無条件の置き換えにはしない。

## 現状の確認

- Web は Zustand の状態をローカル保存し、クラウド接続時に `PersistStorage` の保存先を切り替える。クラウド側は変更後 5 秒で状態全体を圧縮してアップロードする（`src/store/store.ts`, `src/store/storage/cloud/createCloudPersistStorage.ts`）。
- Google Drive は 1 ファイルを `PATCH` で上書きし、更新前のリビジョン照合も、競合時の自動取り込みもない（`src/store/storage/cloud/providers/google.ts`, `src/api/google-api.ts`）。手動の pull / push はある。
- Web の CloudKit は `recordChangeTag` で衝突を検出するが、その後は `updatedAt` の大きい**スナップショット全体**を採用する。同時に別の会話を編集しても片方が消え得る（`src/store/storage/cloud/providers/cloudkit.ts`）。端末時刻のずれも結果に影響する。
- Google の Web 認証は短命なアクセストークンを保存し、50 分ごとに再取得を試す（`src/components/GoogleSync/GoogleSync.tsx`, `GoogleSyncButton.tsx`）。現在のプロバイダーへの切替えでは、認証が切れるとクラウドへの書き込み先がなくなる。クラウド保存中もローカルの確実な書き込みを維持する必要がある。
- `ios2` のネイティブ iOS は CloudKit で Web と異なるレコード名・形式を使い、Google Drive では Web と異なる `appDataFolder` と WVLT 形式を使う。この二つは現在そのままでは Web と同期できない（`CloudKitSyncProvider.swift`, `GoogleDriveSyncProvider.swift`）。今回の共通クライアントを Web とする判断とは分けて扱う。
- 現行のクラウド保存対象には会話だけでなく `apiKey`、`proxyAuthToken` なども含まれる（`src/store/persistence.ts`）。新方式では送信対象を明示し、秘密情報と端末固有設定は既定で端末内に残す設計にする。
- 現在の Web 側には JSON 2 MB / 圧縮後 1 MB のアップロード制限がある。このままでは大きな履歴の同期が止まる（`src/store/storage/cloud/guards.ts`）。

## サービスの適合性

| 項目 | CloudKit private database | Google Drive | Dropbox App Folder（候補） |
| --- | --- | --- | --- |
| 4 OS の Web | CloudKit JS / Web Services で利用可能。Android と Windows のブラウザでログインの実機検証が必要 | ブラウザ向け API があり適合 | 公式 JS SDK がブラウザと PKCE に対応 |
| ユーザーのアカウント内 | ユーザーの iCloud 容量に計上 | ユーザーの Drive 内。`appDataFolder` は非表示でアプリ専用 | ユーザーの Dropbox 内。App Folder 権限を選べる |
| 競合 | `recordChangeTag` による更新前提条件を提供。ただし内容の統合はアプリ側 | リビジョンは取得できる。現行の上書きには競合保護がない。リビジョン履歴を統合機構とみなさない | `rev` を指定した更新で競合を検出できる。内容の統合はアプリ側 |
| Web でのログイン維持 | Apple の Web Services 文書では通常 30 分、「サインイン状態を保持」で 2 週間。リクエストごとに返る新トークンへ更新が必要 | 現行のブラウザ用トークン方式では期限後にユーザー操作で再取得が必要。更新トークンを使う公式の認可コード方式はバックエンドを前提とする | オフラインアクセス + PKCE で更新トークンを取得し、ブラウザで更新可能。ブラウザ内トークン保管のリスクがある |
| 判断 | Apple アカウント利用者の保存先として可。長期の無操作・ブラウザ再起動後の再ログインはあり得る | 複数 OS の主力候補。ただし Web の頻繁な再認証を完全にはなくせない | 再認証の少なさが重要で、第三のアカウントを許容する場合の候補 |

「iCloud Drive のファイルをブラウザから直接開いて自動同期」と「CloudKit」は異なる。ここで使う iCloud は CloudKit の private database である。Google Drive のファイル履歴や iCloud の変更タグも、アプリの会話・分岐の意味を理解して統合する機能ではない。

## 推奨する共通同期プロトコル

### 1. ローカルを常に書き込み可能にする

IndexedDB を編集データと未送信変更の永続的な保存先にし、クラウドは非同期の複製先とする。認証切れ・オフライン・容量超過でもローカル編集を失わない。UI は「端末に保存済み」「クラウドへ送信待ち」「他端末と同期済み」「要確認」を区別する。`pagehide` 時の通信成功を保存完了と扱わない。

### 2. 全量上書きをやめ、同期単位を分ける

会話を ID ごとの単位とし、分岐木・本文ストア参照を同じ単位の有効なデータとして扱う。フォルダ・プロンプト等の共有設定は別単位にする。テーマ、画面幅、端末内モデル、認証情報、API キー類は既定で同期しない。削除は即時の物理削除ではなく削除記録を残す。各単位にはスキーマ版、ID、作成端末、変更 ID、祖先の変更 ID、内容ハッシュを持たせる。祖先情報は同じ端末で複数回編集した後でも並行編集を判定できる範囲で保持する。

### 3. クラウドでの同時上書きを避ける

第一案は**端末ごとのスナップショット**を各アカウントに保存する方式。各端末は自分のファイル／レコードだけを更新し、他端末のものは読んで統合する。Google Drive は複数のアプリ専用ファイル、CloudKit は private database 内の端末別レコードを使う。これなら異なる端末間で同じファイルを競合して上書きしない。同じブラウザプロファイルの複数タブは書き込みを直列化し、対応 API がない環境では同時編集を制限する。端末 ID が失われて新規ファイルが増えた場合に備えて、古い端末データの整理機能を用意する。削除記録と未解決の競合版は整理時も消さない。

この方式では端末数に比例してクラウドの保存量と読み取り量が増える。まず想定する数台で容量・同期時間を測り、許容できない場合だけ変更ログ方式へ移る。Drive の `appDataFolder` は既存の Web のユーザー可視ファイルとは別領域なので、移行時には明示的な読み込みと再保存が必要。

### 4. アプリ側で統合する

起動時、復帰時、送信前、一定間隔で全端末の変更を取得する。同じ変更 ID は一度だけ適用する。異なる会話の変更は共存させる。同じ会話で片方の変更 ID が他方の祖先にあるなら子孫を採用する。共通の祖先から別々に編集した場合は自動的に一方を捨てず、双方の版を残して「競合したコピー」として表示し、利用者が統合または選択する。削除と編集の衝突も同様に確認対象とする。端末の時計だけで勝者を決めない。同期後の状態は再起動後も同じになるよう、同じ入力から同じ統合結果を得る。

### 5. 認証とプロバイダー

ユーザーが同期先を一つ選ぶ。異なるクラウド間の自動橋渡しは行わず、移行操作でコピーする。CloudKit は Web トークンの回転を直列化し、失敗時は再認証が必要と示す。Google Drive は現行の Web トークン方式を前提に、期限切れを送信待ちとして保持して再認証後に再開する。Dropbox を採用するなら PKCE、最小権限の App Folder、更新トークンの安全な保管方針を別途決める。

## 導入順序と確認基準

1. **同期対象と共通形式の決定**：秘密情報の除外、会話と本文の整合性、旧形式からの一回限りの移行とバックアップを定義する。
2. **ローカルキューと状態表示**：認証切れ、通信断、ブラウザ終了、容量超過でも変更が残ることを確認する。
3. **端末別保存と統合**：CloudKit / Google Drive の両方で、異なる会話の同時編集、同一会話の同時編集、削除と編集、同じプロファイルの複数タブを試す。競合時にどちらの本文も消えないことを合格条件にする。
4. **認証の実機調査**：Windows Chrome / Edge、macOS Safari / Chrome、iPhone Safari、Android Chrome で、初回認証、ブラウザ再起動後、数時間・数日後、ポップアップ制限、ログアウトを測る。Apple 文書のトークン期間は Web Services 文書に基づくため、この実測で補う。
5. **ネイティブ iOS 対応の判断**：`ios2` も共通同期対象にするなら、WVLT と Web の lz-string 形式を共通形式へ移し、同じ ID と統合規則を使う。単にレコード名を揃えるだけでは互換にならない。

## 参照した一次資料

- [Apple: CloudKit JS](https://developer.apple.com/documentation/CloudKitJS)、[CloudKit Web Services の認証トークン](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/SettingUpWebServices.html)、[変更タグと競合](https://developer.apple.com/documentation/cloudkitjs/cloudkit.ckerror/conflict)、[private database の容量](https://developer.apple.com/documentation/cloudkit/ckcontainer/privateclouddatabase)
- [Google: Web のトークン方式](https://developers.google.com/identity/oauth2/web/guides/use-token-model)、[認可方式の比較](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)、[Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)、[Drive のリビジョン](https://developers.google.com/workspace/drive/api/guides/manage-revisions)
- [Dropbox: 公式 JavaScript SDK とブラウザ PKCE](https://dropbox.github.io/dropbox-sdk-js/)、[トークン更新 API](https://dropbox.github.io/dropbox-sdk-js/DropboxAuth.html)、[更新モードの概要](https://www.dropbox.com/developers/reference/migration-guide)
