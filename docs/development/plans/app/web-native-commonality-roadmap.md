# Web版とネイティブ版の共通化に向けた段階的計画

最新補足（2026-10-20）：旧iOS JSON・TLVW/zstd・旧CloudKitに続き、旧Google appData保存のreadonly取得も既存確認・選択取込みへ接続した。最新main=a4d83db6の同期wire差分、proxy管理、永続stream状態は共有処理を両版で使用する形で反映済み。通常同期のtarget/etag/baselineは移行取得では変更しない。旧Google取得は専用scopeとメモリ内資格情報で通常認証から分離し、Webの通常認証scopeは拡張しない。実Google/CloudKit相互運用、旧Google appData可視性、実iCloud配信、残るUI/OS/性能確認は未完了。将来AppState version2と既存WebV2の曖昧性を対応済みと扱わない。詳細は[検証台帳](web-native-completion-ledger.md)。
最新の機能差照合（2026-10-20）：PNG書出しを既存Markdown描画・表示projectionとnative WebKit画像化で接続し、サイドバーから既存書出し画面を開けるようにした。固有12件のCatalyst成功、実PNG保存/目視、独立Astraの指摘解消を確認。Cohere固有生成とtool実行はWebにもなく、単なる一覧掲載を機能対応と扱わない。サイドバー会話行の停止も既存処理へ接続し、Catalyst実操作・再起動保持と独立Astra監査で確認済み。次はWebで到達可能な別会話のremote並行生成（nativeは単一生成）を対象とする。共有可能な対象判定/結果適用をWebから再利用し、nativeのTask/資格情報/保存接続を分離する。単なる全体guard解除や別言語での業務rule再実装にはしない。全オンライン・UI/OS受入は未完了のまま。


2026-10-12。状態は段階的に実行中。Web版の機能仕様を起点に、Web版とiOS版で共通仕様・内部APIの責務・必要な共通コードを育てる。iOS版はUI・ドメイン処理・保存・通信・ビルド構成を含めて全面的に作り直すことを許容し、旧実装の構造を維持する制約は置かない。目的は、同じ機能の修正で両版の意味がずれることを減らし、各環境に適した実装を保ちながら保守と移植の負担を下げること。

詳細設計は各段階の対象を絞ってから行う。現時点では関数シグネチャ、共通パッケージ構成、Rust導入、保存形式変更を確定しない。計画作成時には製品コードを変更せず、実装は下記の進捗と対象範囲に従う。

## 対象と制約

- WebとiOSの会話・分岐・生成・保存・同期に関わるアプリ独自の規則を対象とする。Webの既存挙動を出発点にするが、Web固有の制約や不具合まで共通仕様にしない。
- 2026-10-12のユーザー承認により、新iOSの最小チャット表示と確定済み兄弟一覧の実装を開始する。検証先はMac Catalystとし、シミュレータは使用しない。旧iOSはそのまま保持し、新実装は別bundle IDで既存保存データ・同期接続から分離する。旧ソースは過去の仕様・データ形式・OS接続の参考とし、その未実装部分やクラス構成を新実装の機能上限にしない。
- 2026-10-14の追加指示により、通常のビルド・テスト・画面確認はCatalystで行う。iPhoneはユーザーの目視確認用とし、その都度の明示指示がある場合だけ端末向けビルド・インストール・起動・実機テストを実施する。既存の実機成功結果は保全し、未確認事項を自動更新の理由にしない。
- OS API、ビルド要件、依存ライブラリやフレームワークの変更できない制約は前提として記録する。UI、通信、保存媒体、鍵管理、バックグラウンド実行、推論実行方式を無理に統一しない。
- Webの既存機能とデータ互換性を維持する。iOSの再構築ではWebの機能を基準とし、旧iOSの画面・状態管理・内部APIは置換可能。要求外の機能追加、Web全体の再実装・状態管理交換、汎用的な共通基盤の新設は対象外。
- iOSの作り直しは保存済みデータの破棄許可ではない。旧iOSデータとWeb同期データの読み取り・移行・旧版との相互利用の範囲を、書込み実装より前に確定する。
- UIはWebの基本構成と操作領域の位置を基準にし、各領域内の配置・コントロールをネイティブ向けに再設計する。[UI調整候補](web-native-ui-adaptation.md)を対応表として用い、旧iOSの配置に合わせるためにWeb機能を削らない。
- ユーザー指定のiOS表示オプションとして、整列したストリームと、ユーザー右・アシスタント左の吹き出し表示を用意する。会話処理は共通にし、配置のみを切り替える。詳細はUI調整候補の表示スタイル節に従う。
- 現在の未コミット変更と並行作業を維持する。段階開始時に対象の基準commitと作業中の差分を区別し、未確定の差分を完成済みの土台に数えない。

## データ形式・オンライン同期の必須互換条件

2026-10-12の追加指示により、Webと新iOSのデータ形式およびオンライン同期方式は、I/Oの結果として完全互換を必須とする。内部表現・状態管理・ローカル保存方式は各環境に最適化してよい。例えばCore Data等を採用してもよく、Webのメモリ配置やDBスキーマを複製しない。互換性は外部への読戻し・書戻し・同期の情報保持と操作結果で判定する。

- Webが外部に入出力する全データ項目・識別子・参照・順序・設定・評価・非表示分岐を無損失で往復できること。内部構造や物理保存の同一性、JSON空白等の意味に影響しない表現の同一性は要求しない。新iOSのUIや機能が未対応でも、未知/未対応項目を捨てて書き戻さない。
- 同期先のrecord/file探索、payload/envelope、圧縮、暗号・鍵導出条件、版判定、競合解決・取消・失敗時の保持を揃える。OS側のAPI・鍵保管・通信実装は個別最適化しても、相手が読む形式と操作結果を変えない。
- Web→新iOS→Webと逆方向の読取・更新・再読取、既存データと未知項目の保持、競合・中断・誤鍵・部分失敗を同じfixtureと接続検証で確認する。
- 旧iOSの独自形式と既存同期データも、データを失わず引き継げる読取・移行経路を確保する。現時点の旧iOSとWebの不一致を互換済みと扱わない。
- 部分fixtureの成功は全互換の証明ではない。保証範囲を減らして完成とせず、未確認を一覧に残す。完全互換の確認前に新iOSから既存のユーザーデータを上書きしたり、オンライン同期先へ書き込んだりしない。新しい内部保存の実装や、隔離したテストデータでの保存・同期検証は先行できる。

## 既存計画との関係

[Web版の段階的リファクタリング計画](web-maintainability-refactor.md)のA〜Eという機能区分と、[Web S0・S1の内部API契約](web-s0-s1-contracts.md)を再利用する。後者はS0の観測とS1の未実装契約を区別しているため、実装の到達状況は現行コードで確認する。

既存計画はWeb内の機能整理、本書は両版で揃える範囲と共有方式の判断を担当する。既存のWeb計画を全面的にやり直さず、対象機能の作業へ共通化の観点を加える。契約に矛盾が見つかった場合は、その対象の設計で解消してから実装し、一方の文書だけを根拠に挙動を変えない。

## 共通化の区分

| 区分 | 揃えるもの | 環境ごとに残せるもの |
| --- | --- | --- |
| 共通仕様 | 操作の意味、識別子、入力・結果、失敗条件、状態の正本、保存・取消・復旧の保証 | 言語の型表現、非同期構文、状態反映の方法 |
| 共通検証データ | 同じ入力に対する期待結果、旧形式、異常系、操作の順序 | 各言語のテスト実行基盤 |
| 共通コード | OSに依存しない計算で、重複保守の削減効果があるもの | 呼出方法、実行場所、必要なバッチ処理 |
| 環境固有実装 | 接続先に求める結果と保証だけを揃える | 暗号・鍵保管、通信、DB、描画、スレッド、アプリ寿命、推論エンジン |

APIは名称や引数の形だけでなく、成功とする時点や操作の単位まで揃える。例えば、メモリへの反映、ローカル保存完了、クラウド同期完了は区別する。共通仕様を満たす実装が二つ残ることは許容し、共通コードの比率を目標にしない。

## 段階と完了条件

| 段階 | 目的と作業 | 成果物 | 完了条件 |
| --- | --- | --- | --- |
| 1 現状差分と対象の選定 | A〜EごとにWebの現行実装・予定契約を整理し、新iOSに必要な責務と環境差を対応付ける。旧iOSはデータ互換と再利用可能な知見の参考として照合 | 機能対応表、互換性上の懸念、最初の試行対象 | 最初の対象、その呼出元・状態所有者・関連テスト・対象外が特定され、未確認事項が明示されている |
| 2 最初の対象の共通契約と検証 | 対象一つについて入力・結果・失敗・副作用の境界を決め、共有できる検証データを作る | 小さな契約書と共通の入力・期待結果 | Webで検証データが実行でき、意図的な差と不具合を区別できる。iOSで未実行であることを明記 |
| 3 Web側の境界整理と試行 | 既存関数を優先してUI・状態管理・I/Oとの結合を減らし、対象の呼出経路を移す | 最小のWeb変更と関連検証結果 | 既存機能と契約を維持し、対象内の旧入口や重複を整理。共通化のためだけの未使用層が残らない |
| 4 共通コード方式の判定 | 既存Webの直接共有、環境非依存部分の切出し、具体的理由のあるnative実装の順に判定。必要な境界一つで小規模に評価 | 採用・保留・不採用の理由と測定結果 | 修正箇所、接続コード、性能、メモリ、配布サイズ、ビルド負担から方針を説明できる。Rustを採用しなくても完了 |
| 5 実装開始後のiOS最初の機能再構築 | 対象機能に必要な最小のアプリ構成を決め、同じ契約・検証データと環境固有の接続を新実装へ組み込む | 両版の対応実装、iOSビルド・起動、互換検証と端末検証の結果 | 対象機能のUIから処理・保存までを確認し、共通契約と環境固有の受入を満たす。全アプリ完成とは区別し、凍結中は未着手とする |
| 6 機能単位で展開 | 成果と負担を見て次の機能を選び、段階2〜5を繰り返す | 対応表の更新、完了した機能の一覧 | 各対象の移行・検証・不要な旧経路の除去が完了。効果の薄い対象は別実装を維持する理由を記録 |

段階1で全機能を詳細設計しない。全体は対応と懸念の一覧までに留め、詳細な呼出追跡と契約確定は最初の対象に限定する。段階3は既存Web計画の該当機能へ組み込み、同じ整理を二重に実施しない。iOSの全面再構築を許容することと、一括で全てを書き換えることは区別し、段階5〜6で機能単位に積み上げる。

段階6の各機能の完了と、新iOSへの切替完了は区別する。切替前に、段階1の機能対応表にある必要機能が環境固有部分を含めて成立し、旧iOSデータとWeb同期データの読み取り・移行・相互利用が確定した保証範囲で検証済みであることを確認する。共通コード化を見送った機能も完成対象から外さない。未対応や未検証が残る場合は切替未完了として記録する。

Webを一機能分先行させ、契約が確定した対象のiOS実装を並行する。iOSへの接続が未検証の大規模な共通コード化は広げない。段階4のネイティブ側評価ができない場合は採用を保留し、Webだけの結果で両版に有利と結論しない。

## 対象を選ぶ順序

最初は、入力と結果を固定でき、永続データを書き換えず、UIや実行環境との結合が少ない処理を選ぶ。分岐木の読み取り・経路計算や生成入力の正規化などを候補とし、段階1で実際の依存と機能差を確認して一つに絞る。

| 機能 | 共通化候補 | 進め方 |
| --- | --- | --- |
| B 会話編集と表示 | 分岐木の読み取り・操作、本文の扱い、保護規則、編集履歴の単位 | 小さな読み取り処理で試行後、状態変更へ進む。描画・編集UIは環境に残す |
| A ライブラリと探索 | 会話の複製・削除、検索範囲、IDによる移動 | Bの状態変更契約と整合させる。画面遷移やスクロールの実装は統一しない |
| C AI処理の実行 | 入力確定、設定解決、結果適用、取消と古い結果の拒否 | Bの適用契約とDの実行寿命を踏まえる。通信と生成の実行機構は環境に残す |
| D ローカルモデル運用 | 資産の状態、利用中の所有権、削除と失敗の規則 | 各版の対応範囲を先に確認。WebのWorkerやファイル管理方式をネイティブへ強制しない |
| E 保存と同期・交換 | データ形式、検証、移行、競合解決、保存成功の保証 | 互換性の差は段階1で先に確認。書込みや形式の変更は別の移行単位として扱う |

保存・同期の互換性に重大な欠落があれば、便利な共通ユーティリティよりも、その契約と検証を優先する。ただし、調査で差を見つけたことだけを理由に旧iOSや保存形式を変更しない。

## 先に確認する互換性の論点

Webの`src/utils/contentStore.ts`は差分圧縮と保存後の削除を扱う一方、iOSの`Domain/Services/ContentStore.swift`は差分圧縮を対象外とし、参照数がなくなった内容を即時削除する。これは代表箇所の静的確認であり、全ての保存・同期経路で不整合が発生すると確認したものではない。段階1で形式変換と適用経路まで追い、互換性の保証範囲を決める。

共通検証では、Unicodeと文字数の単位、JSONの欠落値とnull、数値と日時、列挙順、ハッシュに使う直列化、ID生成などの言語差を対象にする。現在時刻や乱数が必要な操作は、その扱いを契約で決め、同じ操作を比較できるようにする。既存IDやハッシュの変更を、境界整理のついでに行わない。

失敗ケースには破損入力、未知の形式、消失した対象、取消後の結果、部分保存を含める。比較は内部メモリ表現の完全一致ではなく、契約上必要な結果とデータ保持の一致を基準にする。

## Rustと環境固有APIの判断

Rustを採用する場合の候補構成は、同じソースをWeb向けWASMとiOS向けネイティブライブラリにコンパイルする方式とする。iOSへWASM実行環境を追加することは前提にしない。具体的な接続方式と配布構成は段階4まで決めない。

採用候補は、まとまった入力と結果を持ち、OSに依存せず、二重実装の修正負担が大きい処理。小さな関数を大量に言語境界越しに呼ぶ構成や、操作ごとに会話全体を変換・コピーする構成は避ける。既存Webコードの直接共有、環境非依存部分の切出し共有、具体的理由のあるnative実装の順に判断する。単体のSwift関数が短いことや比較テストが通ることだけでは別実装の根拠にしない。橋渡し・ビルド・保守・検証を含む総コストで選ぶ。

## 2026-10-13：実装配置の限定修正

目的は同じ機能の二重実装を比較テストで維持することではなく、既存Webのアプリルールを共有し、環境固有部分を分離すること。これまでの動作・互換性の受入は記録として残すが、Swift側に同じ規則を持つ範囲は共有化の完了とは数えない。現成果・未コミット変更を保全し、全面再設計は行わない。

| 対象 | 共有元と限定した変更 | nativeに残すもの |
| --- | --- | --- |
| 編集・属性保持/投影 | `branch-domain.ts`、`branchUtils.ts`、`contentStore.ts`の純粋操作を利用する。状態依存があればWebも利用する境界へ切り出す。Swiftの同一ルールを段階的に薄い呼出へ置換 | 編集UI、OS入力、保存成功後の公開 |
| record変換 | 既存共有同期bundleにある`records.ts`の実変換を利用する。現在のnative変換adapterと未使用stubを必要な実依存へ接続し、Swiftの変換規則を重複維持しない | Keychain、暗号実行、通信、耐久保存。圧縮は既存共有コードとnative呼出境界を評価 |
| 生成要求 | `submitHelpers.ts`の文脈選択/整形と`api.ts`の本文構築を共有可能な境界へ切り出し、Web/native双方から呼ぶ | 資格情報取得、HTTP実行、OS上の取消・背景処理。アプリの世代照合等は別実装の必要性を別途判断 |
| フォルダ | 作業中の`chatFolders.ts`をWeb実callerとnativeの共通ルールにする。Swift操作実装は保全し、共有接続後に置換 | リスト/メニュー、ドラッグ等の操作、原子的保存 |
| 全state投影 | full snapshotとV3の共有5項目、未知root sidecar、編集差分反映を環境非依存処理へ置く。作業中のSwift版を既定路線にしない | 内部DB/保存envelope、表示モデルへの変換 |

順序は、進行中のフォルダと同期変換/全state投影を共有方式へ修正し、その後に既存の編集・生成要求を機能一式ずつ置換する。JavaScriptCoreの固定bundleは既に稼働する共有同期経路として第一候補にするが、別機能へ採用する際は入力の大きさ・境界往復・依存・保守費用を確認する。Rust/WASMやSwiftへの言語移植そのものを成果にしない。共有後の本番経路が確認できるまでは旧実装を壊さず保全し、完了後に同じ規則の保守先を一つにする。

全state接続では、`prepareChatForExport`を内部snapshot投影へそのまま流用しない。同関数は書出し対象node/hashを選別し参照数も再計算するため、未参照entryや元deltaを保持する内部文書の要件とは異なる。共有するのは既存の本文解決・属性捕捉・activePath投影等の処理であり、書出し時の選別を内部保存へ持ち込まない。

共通ルールは共有元で検証し、nativeでは変換・呼出・保存/取消等の接続を検証する。比較fixtureは移行時の退行検出と、必要性を説明できる別実装の境界確認に使用する。既存テストは情報保持の保証を残して整理し、新旧両実装を永続的に同じsuiteで維持する設計にしない。機能一式の関連検証と独立Astra監査を維持し、小変更のゲートは増やさない。

差異が出た場合は、外部仕様上無関係な表記、アプリが意味を与える順序、不要な再構築による変化を分けて原因を記録する。特にnode列挙順・配列順・ハッシュ対象の直列化は単なるJSON key順と一括しない。先の生成テスト2件では属性投影によるmessage object key順のみをcanonical比較から除き、全値・UTF8文字列・配列順を確認した。ただしこれは投影の再構築を恒久的に認める設計判断ではない。属性投影共有時に再構築の必要性も見直し、情報欠落や意味のある順序差を比較変更で隠さない。

暗号はデータ形式、鍵導出条件、nonce・認証タグ・追加認証データの扱いを揃え、実行と鍵管理は各環境の適切なAPIを優先する。Web側の既存Web Crypto利用を基準に、ネイティブ側で対応する手段を検討する。共有コードの都合で鍵を外へ取り出したり、ハードウェア機能を失ったりする設計は採らない。ネイティブAPIの利用だけで省電力化を保証せず、必要な端末測定を行う。

## 検証と移行の運用

- 検証ゲートはファイルや部品単位ではなく、利用者の操作から保存・再読込みまたは同期結果まで通る機能単位にまとめる。小さなcodec追加やadapter変更を、それぞれ独立した監査段階にはしない。
- 各機能の実装をまとめた後、関連テストと必要なビルド、独立Astra監査を一回行う。指摘修正後は影響範囲だけ再検証し、変更していない既受入範囲の監査を繰り返さない。担当者と親でsource・依存・fixture・設定が同じなら同一suiteを重複実行しない。
- 中間ゲートはデータ移行・既存データへの不可逆操作・認証や暗号境界の変更など、先へ進む前に確認が必要な場合に限る。通常のUIや内部整理は機能単位のゲートへ含める。Catalystの実操作は新しく接続した利用経路の確認に絞る。
- 各対象の開始時に、その対象だけの成果物、非対象、必要な検証、完了条件を確定する。全機能の詳細設計完了を着手条件にしない。
- 共通検証データを使う契約テストと、通信・保存・画面など各環境の接続を確認するテストを分ける。共通コードが同じでも、接続部分の正しさは別に検証する。
- 実装後にリスクに見合う関連テスト、型検査・ビルド、差分確認をまとめて行う。性能に関わる変更だけは同じデータと環境で変更前後を比較する。
- 保存形式変更は独立した変更として、旧形式の読み取り、新形式の再読込み、失敗時の元データ保全、旧版との相互利用と戻せる範囲を確認する。コードを戻すだけでデータも戻るとは扱わない。
- 成果は、同じ規則を修正する箇所の減少、契約の検証可能性、両版の差の把握、実行時とビルド時の負担で評価する。行数だけで成功と判定しない。
- 完了条件を満たした対象では追加の整理を続けず、次の対象の必要性を判断する。共通化による負担が利益を上回る場合は、その対象のコード共有を止める。

## 現在の進捗（2026-10-12）

全体目標の判定は[完成条件と証拠](web-native-completion-ledger.md)で管理する。部分段階の受入を全体完成と扱わない。55個の永続化rootとネスト項目を含む[合成corpusとWeb wire検証](web-native-io-coverage.md)、nativeのV3読取・書出し、会話管理・本文編集・分岐の保存と再起動復元を追加。Google同期のnode順序・content entry未知metadata・未知persist root保持を受入済み。次はremote生成、同期provider接続、旧形式message未知属性と旧データ移行を進める。

| 段階 | 状態・成果 |
| --- | --- |
| 1 | [A〜E対応表と互換性懸念](web-native-stage1-map.md)を作成。Sol Medium 2体とLuna Mediumで分担、独立Astra Low監査で新規指摘なし |
| 2 | [兄弟一覧の契約](web-native-branch-siblings-contract.md)と共有JSON fixture作成。実Web関数で9件、関連gesture 5件、計14件成功。型検査成功。独立Astra Low監査で受入 |
| 3 | この対象は既存関数が必要な読取境界を持つため製品変更なし。Astraも追加分割不要と判定 |
| 4 | この小関数へのRust導入は見送り。より大きな処理とnativeの測定は保留。性能・配布サイズ等の比較完了とは扱わない |
| 5 | [Catalyst試作](../../../../ios-rebuild/README.md)を実装。Catalyst全33件・両表示と分岐操作、合成V3の実ファイル往復一致・隔離保存・実再起動復元を確認。Astra Mediumの深度境界指摘を修正し受入。同期は未接続で段階5全体は未完了 |
| 6 | Eの[展開本文V3読取契約](web-native-exchange-read-contract.md)と10caseを追加。関連62テスト・型検査成功。Astra Medium指摘1件修正・再監査完了。評価・system promptを含むcorpusと関連138テスト・型検査、独立Astra監査を追加。全体展開・切替は未完了 |

ユーザー指定の独立Astra LowまたはMedium監査は、上記の機能単位にまとめて行う。段階2〜5の個々の作業や文書更新ごとには追加せず、指摘は当該機能の受入前に解消する。依存しない別機能の作業は並行して進める。Terraは今回の起動可能モデルに含まれず、設計担当はSolで代替した。旧Solの計画監査と今回のAstra段階監査は別の記録とする。

## 独立監査

2026-10-12、独立したSol 6.1 Mediumが監査。旧前提の初回は新規指摘なし。iOS全面再構築の前提を伝えて再監査した結果、新iOSへ切り替える全体の完了条件が不足するP2指摘が1件あり、段階6に必要機能と旧iOS・Web同期データの検証条件を追加した。

修正後の再確認ではP2解消、新規指摘なし。同時に完成したUI調整候補も監査し、両文書を計画・調査成果物として受入可能と判定。これは静的な文書・代表ソースの確認であり、実画面・実装・ビルド・性能の検証完了を意味しない。

その後、ユーザー提供画像で右上二カプセルの対象が判明したため、UI文書の未特定扱いと評価入口の配置案を訂正した。この画像反映は上記監査後の更新である。

## 2026-10-13 placement/cost audit follow-up

Independent read-only Astra review found five remaining maintenance-cost issues in current main: Swift ChatLibrary duplicates Web library rules/defaults; Swift MessageEditing duplicates branch/content rules (replacement in progress); MessageAttributes duplicates Web namespace/projection rules (must be removed through document/editing integration); primitive calls repeatedly load/evaluate the 406,244-byte shared bundle (batch at document-operation boundaries, no speculative global cache); unused RecordsBridge/DMP resources and old unreferenced adapter snapshots remain. Runtime cost was not measured.

Finish editing/document sharing first, including attribute handling and operation-level bridge calls. Then share existing Web chatLibrary operations instead of extending Swift library rules. Archive unused earlier artifacts before removing active resource references and obsolete generated inputs. Keep native UI, URLSession, Keychain, CryptoKit, atomic storage and the lossless OrderedJSON boundary; keep LZ for external wire compatibility. No broad redesign or extra per-file audit gates are required.


### 2026-10-13: 最新 main の統合による計画差分

- 基準を `origin/main` の `7a0a383a`（#523）へ更新する。元作業場所は変更せず、未コミット成果を `3bf7e881` に保全した専用 worktree/branch `codex/shared-main-integration` で統合した。
- Web の新しい NodeTarget API、読み取り専用ファイル閲覧、階層フォルダ、選択インポート、要約、汎用暗号化同期の経路を使用する。古い UI/store 呼出しを維持するための別実装は増やさない。
- フォルダ・ライブラリ操作は最新 Web の動作を共有 utility に集約する。同期生成物も旧 Drive 専用クラスから最新の汎用同期クラスへ追従する。端末固有設定の同期除外は Web 正本の仕様に合わせ、完全ファイル I/O の未知データ保持とは区別する。
- 次の機能単位は引き続き編集中の共有編集・full-state document 接続と native ライブラリの共有化。別 worktree の途中成果は保全しており、旧 bundle や旧 Web ファイルを新しい基準へ丸ごと上書きしない。native の全削除時の未参照 entry 保持など、新しい Web と異なる旧 Swift 規則は共有化の完了まで未達として扱う。
- 検証は統合一式の Web テスト/型/build、Catalyst、独立 Astra にまとめる。差異の原因を特定した失敗箇所だけ再確認し、小変更ごとのゲートは追加しない。

### 2026-10-13: 共有編集・文書保存・会話管理の受入

上記の接続途中だった3範囲は、実Web処理を呼ぶ構成で機能単位の検証と独立Astra監査を完了した。Swiftの編集/属性/会話管理規則は撤去し、Webの初期定数と更新時刻判定も共用する。保存v2と旧形式の読取、raw delta・未知値の保持、保存失敗時の非公開を接続テストで確認した。詳細と再実行の区別は[完成条件と証拠](web-native-completion-ledger.md)に記録する。次はこのfull-state境界を使う同期provider/UI接続と残る機能を進める。全面再設計や言語移植は追加しない。


## 2026-10-13：独自実装と依存ライブラリの境界監査

独立Astra Mediumが `ede385f1..9e2748a3` のローカル生成、共有TS、native C API境界、取得・ビルド手順と関連テストを確認した。upstreamの保守・license・公開advisoryを直接調査した依存はllama.cppとwllama。全npm/Swift依存、Apple framework自体、全lowbit kernelの網羅監査ではない。詳細な修正状態・検証結果は[完成条件と証拠](web-native-completion-ledger.md)に記録する。

| 配置 | 今回の判断と根拠 | 主な実装箇所 |
| --- | --- | --- |
| 既存Web実処理の共有 | 生成入力、fallback prompt、出力・stop、モデル切替・出力上限はアプリ固有規則。Swiftへ写さず実Web callerと同じTSを呼ぶ。localのthinkタグも実Webどおり本文として保持 | `src/utils/localGenerationInput.ts`、`localGenerationOutput.ts`、`localModelLimits.ts`、`shared/google-sync/chatConfig.ts` |
| OS標準 | JavaScriptCore/WKWebView、Foundation、security-scoped URL、CryptoKit SHA-256、Metalを使う。UI・通信・Keychain・暗号・保存の既存native優先境界を維持し、周辺の業務規則まで別実装にしない | `ios-rebuild/WeaveletPilot/LocalGeneration.swift`、既存共有bridge/描画/保存接続 |
| 公式または既存ライブラリ | loader/tokenizer/chat template/decode/Metalは公式llama.cpp。samplingはWebで使用するwllamaのC++実装を薄いC ABIから直接呼ぶ。独自tokenizer/samplerを追加しない | `ios-rebuild/WeaveletPilot/LocalLlama.swift`、`ios-rebuild/NativeLlama/Sampling.cpp` |
| 必要な独自実装 | 生成・取消・保存の接続、モデルIDと端末ファイルの対応、C ABI、取得/ビルド検証は製品またはOS境界の責務。既存lowbit対応は同じC sourceを両環境で使うが、本repoが保守責任を持つ | `Conversation.swift`、`LocalGeneration.swift`、`ios-rebuild/NativeLlama/build.sh`、`vendor/wllama-patches/` |

採用順序は「既存コードの再利用→OS標準→既存依存→必要性を説明できる追加依存」とする。公式に近いという理由だけで安全と判定せず、保守継続、固定revisionへの既知修正の反映、実際に使う入口、ライセンス、取得元・生成物の照合、更新時の接続/ビルド/検証コストを対象機能内で確認する。機能追加のたびに全依存監査を繰り返す運用は追加しない。

今回、別LLM SDK・Swift llama wrapper・別JS runtime・別tokenizer/sampler/Markdown parserを追加する必要はない。これらの候補製品を個別比較して不採用にしたという意味ではなく、既存コードと標準機能で要求を満たせるためである。Rustや他言語への移植も目的にしない。

方針・既存構築への反映：Web setupの誤tagとHEAD fallbackを廃止し、正確tag/SHAを検証。既存sourceを削除せず不一致時は停止する。壊れたpatch 0006を修正し、公式GGUFサイズoverflow修正を0007として両環境のsourceへ適用。nativeではsource/patch/build-input/artifact照合とMIT notice同梱を追加した。独自Swift sampling案を採らずwllama C++を利用し、BOS/EOS処理も実Webと同じ呼出条件に修正した。配布WASMの再生成完了前にWebを修正済みとは扱わない。

公式根拠：[llama.cpp](https://github.com/ggml-org/llama.cpp)、[wllama](https://github.com/ngxson/wllama)、[wllama releases](https://github.com/ngxson/wllama/releases)、[GGUF公式修正](https://github.com/ggml-org/llama.cpp/commit/4e5b83b226919c146fbfa754641a6772bcb2d722)、[CVE-2026-33298 advisory](https://github.com/ggml-org/llama.cpp/security/advisories/GHSA-96jg-mvhq-q7q7)。調査時には両upstreamとも非archive・MIT・保守継続中だったが、古い固定版の安全性とは別判定である。


### iOS全範囲への監査拡張（2026-10-13）

ユーザー指定により、上記ローカル推論だけでなく、再構築版`ios-rebuild`の全40 Swift source、NativeLlama C/C++接続・build、Xcode project/Info/Resources、同期とMarkdownの共有bundle・生成手順・実際に取り込まれるnpm依存まで監査範囲を広げた。独立AstraがI/O・保存・同期・認証/通信/暗号、独立SolがUI/ドメイン、別担当が生成物/依存/licenseを分担した。旧`ios2`は依存持込み有無の確認対象で、新PBXに旧source/外部SPM参照はない。旧版全sourceの品質監査まで完了したという意味ではない。

| 領域と確認したsource | 境界・採用判定 |
| --- | --- |
| `MessageEditing`, `MessageAttributes`, `NodeOptions`, `BranchNavigation`, `ChatLibrary`, `ChatFolders`, `ChatSearch`, `ChatConfig` | 編集・属性・分岐・一覧・検索・設定の規則は実Web共有元を使用。SwiftはID/引数/結果の変換・型付け・状態公開。不要な別アルゴリズムや追加SDKを要する具体例なし |
| `Conversation`, `LocalGeneration`, `Samples` | アプリ状態、Task取消/遅延結果拒否、端末GGUFファイル、サンプル表示はnative責務。Composer/local要求と出力は共有コード。初期保存読込失敗後の上書き問題を発見し下記修正 |
| `WeaveletPilotApp`, `ChatConfigView`, `ChatSearchView`, `NodeOptionsView`, `ProviderModelsView`, `GoogleSyncSettingsView` | SwiftUIの画面と操作配置はnative固有。画面の存在だけで全同期providerや全機能が実装済みとは扱わない |
| `MarkdownTextView`, `AttachmentImageView`, `ImageInputView` | WebのReact/Markdown描画をWKWebViewで再利用。画像入出力はImageIO/PhotosUI。別parser・画像SDK追加は不要 |
| `OrderedJSON`, `OrderedJSONChanges`, `WebExchange`, `ChatImport`, `ChatExport` | JSON原数値・key順・未知属性・UTF8識別の保持は必要独自境界。標準JSON/Doubleへの置換では契約を満たさない。取込/書出しの規則はWeb共有 |
| `LocalStateStore`, `SyncDocument`, `SyncStateStore`, `SyncRecords`, `SyncSession`, `GoogleSyncController` | atomic保存、baseline照合、同期公開journal回復はアプリ固有の保全。文書変換/差分復元は共有。新DB/同期SDKを追加して置き換える根拠なし |
| `SyncCrypto`, `RemoteCredentials` | AES-GCMはCryptoKit、PBKDF2はCommonCrypto、乱数/鍵保存はSecurity/Keychain。独自部分はWeb互換salt/nonce/AAD/envelopeと接続であり、独自暗号算法ではない |
| `GoogleAuthentication`, `DriveTransport`, `RemoteGeneration`, `ProviderModels` | OS認証画面/URLSession＋必要なOAuth/Drive/SSE接続。生成要求・結果の意味処理と一覧整形は共有。Googleは公式iOS SDKを推奨するが現方式も公式native OAuth仕様の範囲。PKCE/state/refresh等の保守は本アプリの責任で、全面的にOS任せとは記載しない |
| `NativeGzip`, `SyncCompression` | OS zlibと既存LZStringによる形式互換。CloudKitは後述の共有snapshot規則・native CKDatabase・手動同期UIへ接続済み。実クラウド確認は未完了 |
| `LocalLlama`, `NativeLlama/*` | 先の公式C API/既存wllama C++監査と修正済み生成物の証拠を再利用。Catalyst arm64の確認をiOS実機や全lowbit形式の保証へ拡張しない |

監査開始時の外部依存：同期bundleにはlodash 4.17.21、diff-match-patch 1.0.5、@babel/runtime 7.21.0、i18next 22.4.11が実際に含まれ、LZStringは別resource。MarkdownにはReact/ReactDOM 18.2、react-markdown 8.0.5、root KaTeX 0.16.4とrehype-katex配下0.15.6、highlight.js 11.7等が含まれる。npm全体をアプリへ同梱する方式ではない。React/react-markdown/KaTeX/lodash/i18next upstreamの活動と、採用中の固定版の安全性は別に扱う。OS framework全OS版CVEや全異常入力の網羅検証は今回の証拠に含めない。

`diff-match-patch`はGoogle公式由来だが、[Google原repo](https://github.com/google/diff-match-patch)は2024-08-05 archived、[npm配布元](https://github.com/JackuB/diff-match-patch)の最終pushは2023年。保守継続中とは分類しない。既存保存deltaの構文と復元挙動を維持するため条件付きで継続し、将来の置換には既存patch適用結果の保証が必要。保守停止を隠して「公式だから安全」とせず、理由なく別差分算法や新依存へ移さない。

具体的修正：初期保存の読込失敗後、createChat/applyFolderが空の文書から`applyLibrary`経由で既存fileを上書きできた。`applyLibrary`と公開`applySnapshot`の保存前に失敗状態の拒否を追加し、明示import/replaceのみ保存成功後に解除する。既存MalformedSaveテストへcreate/folder/snapshot拒否、元bytes保持、明示置換後create成功を追加して成功。独立Astraの限定確認は新規なし。通常style変更はexchange/documentがない時に保存しない既存仕様を維持した。

license監査ではMarkdown生成器がLICENSE不在を黙って省略しており、追跡100package中24がNOTICE未記載だった。実metafileを再確認して欠落24すべてがruntime入力であると確定し、固定版の公式配布元・repositoryのlicenseを照合して24件を補完した。生成器はnested packageの実パス・版を保持し、license欠落や補完版の不一致をエラーとする。新しい管理基盤や依存は追加していない。最終配布NOTICEと依存修正の検証結果は完成条件の台帳に記録する。

検索ごとのbundle読込/全件走査や生成中のプロセス終了は運用上の懸念として残るが、実測・再現なしでcacheや独自indexを追加しない。全機能の動的試験や実Googleアカウント接続を今回の静的全範囲監査と混同しない。[Google native OAuth仕様](https://developers.google.com/identity/protocols/oauth2/native-app)、[Apple認証セッション](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession)、[Apple AES.GCM](https://developer.apple.com/documentation/cryptokit/aes/gcm)。


依存安全性の追加確認：KaTeXのUnicode添字/edefによるmaxExpand迂回は、`MarkdownTextView → shared/markdown/host → MarkdownRenderer`の未信頼会話数式から到達する。trust=falseでも展開DoSの対象であり更新必須。rootだけでなくrehype-katex配下0.15.6も公式0.18.2へ限定更新し、CSS/fontsを含め再生成した。generatorがnested node_modulesパスを潰す来歴不備も修正済み。既存React/Markdown全体の入替えや独自数式フィルターは追加しない。[Unicode添字advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-cvr6-37gx-v8wc)、[edef advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-64fm-8hw2-v72w)。

lodashのtemplate/unset/omitとBabelのwrapRegExpにも採用版のadvisoryがあるが、今回の実共有入口（isEqual等）・bundle入力には該当呼出しなし。現exploitと断定せず、公式修正版への限定更新を既存の同期/描画bundle再生成とまとめて評価する。KaTeXのprotocol/includegraphics/htmlDataは既定trust=falseで通常経路を制限し、[238p](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)は既存prototype汚染が前提で成立未確認。これらの静的条件と、更新後の確認結果を分けて記録する。

最終採用版はKaTeX 0.18.2、lodash 4.18.1、@babel/runtime 7.26.10。npm overridesとCIで使うYarn resolutions/lockを揃えた。lodash 4.18.0はadvisoryの修正閾値を満たす一方、公式registryに「Bad release」のdeprecated指定があり、採用を撤回した。後続4.18.1の非deprecatedとnpm gitHead／公式tagの一致を確認して採用した。版番号だけでなく配布状態を確認する必要がある具体例として記録する。既存業務ルールや保存形式、新たなSDKは追加していない。

全範囲の静的監査と今回の修正確認は完了。関連Web検証、公式KaTeX回帰、Catalyst描画接続、配布NOTICEの一致、独立Astraの指摘解消を確認した。詳細は[検証台帳](web-native-completion-ledger.md)参照。これはiOS全面再構築の機能完成、実機／実クラウド試験、全推移依存の脆弱性不存在を意味しない。

## 2026-10-13：Apple同期とフォルダー同期の最終方針

「iOSではCloudKitを使わない」という途中の指示はユーザーが撤回した。CloudKitはWeb/iOSの同期対象として維持し、それとは別にローカルフォルダー同期を両環境で利用可能にする。Webには既存のFileSystemSync/FileSystemTransportがあるため再実装せず、共有暗号化同期engine・manifest・immutableファイル形式を基準にnative接続を追加する。

- Web：対応ブラウザのFile System Access APIで選んだフォルダを使用し、既存IndexedDB handle保存と権限再確認を利用する。macOS/Windows上のiCloud Drive同期フォルダも候補だが、実フォルダの相互運用は未検証。ブラウザのローカル書込完了をクラウド配信完了とは表示しない。
- iOS/Catalyst：端末内フォルダとiCloud DriveをAppleの文書/ファイルAPIで扱う。フォルダ選択、security-scopedアクセス/再起動後の参照復元、ファイル調整、iCloudファイルの利用可能状態をnative責務とする。新しいCloudKit→Drive変換層や独自同期算法は作らない。
- 同じフォルダ同期datasetをWeb/iOSで読み書きできることを、既存共有同期規則で検証する。未到着・途中書込・遅延配信・同時編集・競合コピー・権限失効・保存失敗の保全を機能一式に含める。既存transportがcloud clientの配信順序を理由にcompactionを無効にしている制約を保つ。
- CloudKitのnative接続とフォルダ同期は別providerとして扱う。既存CloudKitデータがiCloud Drive上へ自動的に現れるとは扱わない。Google DriveのOAuth登録は未実施とユーザー確認済みで、実装・隔離テストを先行する。実Google/CloudKit/iCloud Driveの相互運用が未確認であることは完成条件に残す。

既存機能の再利用方針に沿い、まず共有filesystem transportとnativeファイル操作の境界を確定し、実フォルダの隔離テスト・Catalyst・独立Astra監査を一式で行う。新しい依存ライブラリや小変更単位の監査ゲートは追加しない。


フォルダー同期の実装追記：Web実FileSystemTransport/EncryptedSyncを共有bundleからnativeへ接続した。nativeのファイル/権限/保存境界、UI、journal再開は実装済み。Web関連17 cases、Catalyst関連26 casesの成功範囲（複数run）、実native ciphertext→actual Web→nativeのrecords一致、標準picker/bookmark復元、独立Astra指摘解消を確認した。詳細は[検証台帳](web-native-completion-ledger.md)に記録する。実iCloud配信/placeholder/競合コピーと実ブラウザ権限の確認は残件で、native CloudKit接続も継続対象である。


## 2026-10-13：CloudKitの共有規則とnative接続

CloudKitは廃止せず、Google Drive、ローカルフォルダー/iCloud Driveと別の同期先として維持する。ユーザー確認により旧iOSの公開コンテナーID `iCloud.com.sstcr.WeaveletCanvas` を引き継ぐ。新アプリID `com.weavelet.nativepilot` のコンテナー利用許可と署名は別途成立させる必要がある。`CLOUDKIT_CONTAINER_ID` はInfo.plistとentitlementsで共通参照、DebugはDevelopment、ReleaseはProduction。Webのコンテナーと環境も一致させる。Appleの[コンテナー指定](https://developer.apple.com/documentation/cloudkit/identifying-an-app-s-containers)・[iCloud entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.icloud-services)に従う。

| 処理 | 配置・採用の判断 |
| --- | --- |
| snapshotの形式判定、BYTES用UTF16LE codec、更新時刻の競合判定 | `shared/google-sync/cloudKit.ts`。既存Web providerも共有元を呼ぶ。既存LZStringを再利用し、別言語へ移植しない |
| 容量・全件消去・大幅縮小の保護 | 実Web `cloud/guards.ts` をnative bundleから利用。圧縮文字列のBlob UTF8サイズを使う既存仕様を維持し、native Data.countへ置換しない |
| 受信のデータ版・フォルダー階層 | 実WebのSTORE_VERSIONとfolderHierarchy utilityを共有。nativeに旧版の隔離・移行UIはまだないため、版違いを適用せず元レコードを維持して拒否する |
| CloudKit通信・認証・CAS | Apple公式CloudKit SDKのprivate CKDatabase。取得済みCKRecordのsystem fieldsを保持して `.ifServerRecordUnchanged` で保存し、競合時は実Webと同じ再取得・時刻判定・1回の再試行。追加SDK・独自認証・独自CAS算法なし |
| raw JSON・保存・UI | nativeの既存OrderedJSON/原子的保存を再利用。巨大整数、未知root、未知wrapper metadataを保持し、保存成功後に表示へ反映する |

CloudKitはWebのFULL persistenceを使用し、Google/フォルダーのbrowser-local除外規則を流用しない。nativeのKeychain認証情報をsnapshotへ追加していない。CloudKit payloadをGoogle/フォルダーのパスフレーズ暗号化形式に変換する変更も行わない。標準recordはWebの `weavelet-default-snapshot` / `WeaveletSnapshot` を共有定数から参照し、旧iOS専用 `weavelet-ios-snapshot` の旧形式を自動上書きしない。

今回の機能群は手動受信・送信・競合処理まで。自動同期、旧版のローカル隔離/移行UI、実コンテナーの相互運用は残件。関連Web55 casesの成功範囲と影響5 casesの再確認、Catalyst接続6 casesとrecord変換1 caseの成功範囲、独立Astra2指摘の修正を[検証台帳](web-native-completion-ledger.md)へ記録した。フォルダー同期の成功結果は再利用し、変更のない全領域の監査・保存/同期テストを反復しない。


## 2026-10-13：CloudKit自動送信・旧版隔離の接続

手動同期に続き、保存済みdocumentの変更をnativeキューへ接続した。待機時間は実Webの `CLOUD_SYNC_IDLE_MS` をbundle定数として共用し、5秒のidle待機、連続編集の集約、送信の直列化、送信中の追加変更の保持をnative Task/Combineで実装する。業務ガード・LWW・payload形式は共有元を維持する。backgroundへの移行ではAppleの[background task API](https://developer.apple.com/documentation/UIKit/UIApplication/beginBackgroundTask%28expirationHandler%3A%29)で送信開始を試み、完了時と期限切れ時にtaskを終了する。OSによる送信完了は保証しない。

自動同期は受信/送信を確認してから有効化し、enabled設定と成功済みsnapshotのdigestを原子的に保存する。再起動時に保存済みローカルが成功時点と同じなら受信し、未送信の変更があるなら共有CAS/LWWで送信する。通常の通信失敗はforeground復帰で再開し、旧版検出による停止とは区別する。cold dirty restartでメモリ内metricsがない場合は、再取得した有効なremote snapshotの共通metricsを使用してCAS再送前に縮小ガードを適用する。

旧版は通常受信と競合取得の双方でLWW再送前に検証し、raw BYTESとrecord metadataをnative保存へ隔離する。異なるpayloadを全て保持し、同一payloadのみ重複を省く。解除しても隔離データは保持し、各データのJSON書出しをUIから利用できる。保存失敗・版違い・不正folderは現在の会話へ適用しない。旧版の自動変換を追加したとは扱わない。

追加SDKはなく、キューはOS scheduling、storeはnativeのatomic I/Oと設定/保全metadata、版判定・階層検証・容量/縮小判定は実Webの共有処理という境界を維持する。詳細と検証成功範囲は[検証台帳](web-native-completion-ledger.md)へ追記した。実CloudKitの署名/コンテナー許可、実Web相互運用、OS background期限切れ、今回のUI操作確認は未完了である。

## 2026-10-13：タイトル自動生成の共有とnative接続

実WebのsubmitHelpersを基準に、タイトル用モデル/provider選択、本文構築、引用符処理、利用量加算、設定既定値を `src/utils/chatTitle.ts` へ切り出し、Web callerとnative bundleで共用した。画像件数処理も同じ純粋な共有元に置き、既存cost exportは維持する。公式endpoint定数は既存provider-configを共有元とし、nativeへVite認証初期化を持ち込まない。追加ライブラリや別言語への移植はない。

iOSは保存済みの通常送信完了後にタイトルを要求する。再生成・ここから続ける操作では開始しない。要求は非streamingとし、URLSession/認証情報/redirect制御は既存native境界を再利用する。設定は既存モデル選択画面へ接続し、保存では3つの設定rootだけ変更する。応答反映時は最新の会話・設定・本文の元bytesを確認し、削除、手動命名、本文変更、import/syncによる全体置換の後に古い結果を書き込まない。タイトルと利用量は同じ原子的保存で反映する。

利用量は既存Webの文字数fallbackを共有しており、nativeにWebのWASM tokenizer workerがないため、正確なtoken数の同等性は未完了。今回の接続成功を評価/要約や全機能の完成と扱わない。検証結果・独立Astra監査の修正は[検証台帳](web-native-completion-ledger.md)に記録した。

## 2026-10-13：主生成の利用量・OpenRouter観測保存

実Webの正常終了時の累算を `generationUsage.ts` へ切り出し、実Web callerとnative bridgeを接続した。生成先がactivePath上にあること、観測されたprompt/completion値の優先、観測がない時の送信文脈再構成、画像件数の扱いは共有規則とする。Webのtokenizer workerは維持し、nativeは同じ文字数fallbackを使用する。OpenRouterのusage/header解析と生成先nodeの観測更新も実Webから純粋処理を分離し、再利用する。

nativeは正常終了したremote生成だけ累算し、Stop・通信失敗・localでは累算しない。これは実Web callerの現在の挙動に合わせた判断であり、localの計測機能を独自に追加した結果ではない。本文・観測・累算を一回の原子的保存で反映し、保存失敗時の再試行で二重加算しない。本文到着前のusage-only停止も観測を保持する。変更対象のcounterがJSC数値安全範囲を超える場合は、丸めずに保存を拒否して生成結果と原文を保持する。同じ数値境界検証をタイトル利用量にも適用する。

未変更の未知属性・巨大整数は保持する。この時点では利用量設定/費用表示UI、正確なtokenizer、OpenRouter事後照合、実API/実オンライン同期の証明を残件とした。今回の機能群へ追加の管理基盤や依存SDKは導入しない。

## 2026-10-13：利用量設定・費用表示

価格情報の解決、単価計算、未知モデル/料金情報欠落/無料の判定、モデル別・合計の表示精度を既存Webから純粋な共有処理に分離した。実WebのmodelLookup/cost、費用表、sidebar表示とnative bridgeが同じ処理を使用する。custom→favorite→cacheという既存の優先順と、無料判定には1件以上必要なことを維持する。

iOSの設定へ利用量の累計、モデル別推定費用・合計、累計リセットを接続した。設定とリセットは対象rootだけ原子的に保存し、進行中の生成と未保存本文を維持する。生成中の推定は表示用overlayとし、保存済み累計へ書き込まない。送信文脈、画像数、key、文字数fallbackは既存共有元、completion先頭がreasoningの場合はlive completionを計数しない規則も実Web/native双方で共用する。保存後の累算とは分けて扱う。

料金の推定は実請求額の証明ではない。正確なtokenizer、OpenRouter事後照合、実API/実クラウド相互運用と画面の手動操作は残件。今回のCatalyst接続・保全確認と独立Astra監査は[検証台帳](web-native-completion-ledger.md)に記録する。追加SDKはない。


## 2026-10-13：実機導入の基盤修正

監査済みcheckpointをiPhone Airへ署名・インストール・起動した。Automatic signingのチームとCloudKitコンテナー権限を明示し、iOS署名に支障があったMarkdown同梱フォルダ名をMarkdownResourcesへ変更した。共有処理と既存アセットを維持し、同じ変更はCatalystの既存表示接続テストで確認した。実機導入とクラウドの実接続確認は別の証拠として扱い、Debug DevelopmentとWeb Productionの相互運用は未確認。詳細は[検証台帳](web-native-completion-ledger.md)に記録する。


## 2026-10-13：バブル要約・圧縮

既存Webの対象選択、原文snapshot、要求構築、応答評価、要約CRUD、表示判定を純粋な共有元へ分離し、実Web callerとnative JSC接続で使用する。SwiftにはID/未知値の変換、URLSession、原子的保存、SwiftUIだけを残した。単一・ここまで・選択範囲、読みやすい要約・圧縮、生成/停止、生成設定、候補の表示/送信採用と削除を接続した。削減成功時の自動採用、削減しない場合の原文継続、送信除外nodeを含む範囲の原文復帰も共通規則へ従う。

実Webは非空の要約応答について累計ON/OFFとは独立に利用量を累算するため、その挙動を維持する。主生成やタイトルと同じ条件へ勝手に統一しない。nativeは共有文字数fallbackを使い、Web workerの正確なtoken数との同等性は未確認。Catalyst機能群確認と独立Astra監査後の限定再監査を完了。詳細は[検証台帳](web-native-completion-ledger.md)。要約追加のiPhone Air再インストール、実API、実クラウド同期はこの段階で行っていない。


## 2026-10-13：評価の共有元・nativeオンライン評価・チャット配置

既存Webの評価文脈、judge要求、応答解析、結果更新、閾値表示をpure coreへ分離し、Web実callerとnative bridgeから共用する。nativeはKeychain・URLSession・URL/secret束縛・世代照合・原子的保存だけを担当。安全性評価のWeb CORS proxy条件はnative直接通信には不要で、OpenAI専用credentialとOpenRouter必須制約の拒否は維持する。今回のnative範囲は手動オンライン評価（品質/安全性、単一/全文、除外発言の扱い）と結果保存・閲覧。自動評価、local/hybrid評価と評価設定全体は次の接続範囲であり、local analysis指定を無視してremoteへ送らない。

ユーザー追加指示に従い、Webの配置をiOSで再現する調整を進める。今回バブル左にrole/avatar・star/pin、右に表示形式/評価/除外/保護/操作をまとめ、44pt操作領域と狭幅の段組を維持した。Markdown/raw切替の重複行を右上menuへ統合し、本文端を維持。タイトルを現在会話名のinline表示、入力欄を下端固定、履歴と会話操作を上部menuへ移した。次は全体のサイドバー・分割表示、会話/フォルダー一覧と分岐表示の配置をWeb基準で調整する。Catalyst機能群確認・独立Astra監査完了の証拠は[検証台帳](web-native-completion-ledger.md)に記録する。


## 2026-10-13：ローカル品質評価・サイドバー

Webの5軸prompt、空応答fallback、採点/解析、local safety/hybrid判定を共有coreへ移し、Web実callerを接続。native品質評価は既存wllama/NativeLlamaと実GGUFへ接続し、共有promptと結果だけを使う。remote secretは遅延読取でlocal実行時に読まない。モデルregistryと端末実ファイルを区別し、評価中のGGUF置換をOSのファイル世代で拒否する。Web由来の分析モデル割当と既存ファイルimportを使用する段階で、割当/資産管理UI、Transformers分類器、自動/hybrid評価とiPhone向けnativeエンジンは残件。

会話/フォルダー一覧を既存Viewの再利用でサイドバーへ移し、wideはチャットと同時表示、compactはpreferredCompactColumnで一覧/詳細へ移る。Apple公式APIの列制御を使用し、700px独自幅判定を廃止。wideの重複buttonと0件選択footerを除去。Catalyst確認と独立Astra監査の記録は[検証台帳](web-native-completion-ledger.md)。次はiPhoneのエンジン接続と残るモデル/評価設定、分岐表示・一覧並替えを進める。


## 2026-10-14：Branch editor配置の共有と依存境界

f0c80deeで既存Web workerの配置計算をpureなbranchLayout.tsへ移し、実workerは受信・送信だけを担当する。通常treeと切断cycleのfallbackは同じ処理を維持し、Swiftで別の配置算法を作らない。既存4ケースとWeb型検査は成功。native画面/bridgeへの接続は未完了で、この切出しをBranch editor機能完成として数えない。

独立Astraの限定依存監査：既存dagre0.8.5はgraphlib2.1.8とlodashに依存し、静的importのためfallback未実行でも配布対象になる。公式repository自体は非archiveだが、[公式Dagre方針](https://github.com/dagrejs/dagre)は保守対象を@dagrejs/dagreだけとしており、旧packageの保守継続とは区別する。監査時点の公式3.1.1は@dagrejs/graphlib4.0.5を使用し、後者にはruntime依存がない。[公式graphlib](https://github.com/dagrejs/graphlib)。両MITで、追加配布には固定版来歴とcopyright/licenseを含める。公開advisory照合で該当0件だったことは安全保証ではない。

旧Dagreを新nativeへ無条件配布する方針は採らず、Web側も同じ公式保守packageへ限定置換できるか検証する。通常tree不変、cycle/selfloop/componentのnode・edge・列挙順・有限位置を確認し、差があれば描画位置の差と意味の変化を区別する。元libraryと新libraryを恒久並存させず、npm/Yarnの固定版を揃える。現在は更新担当による確認中で、採用成功やnativeへの配布済みとは扱わない。

native UIで描画する場合はJSCで配置だけを共有し、OSの表示・hit testing・pan/zoomへ接続する。Web BranchEditor全体をWKで使う案ではReactFlowの操作を再利用できる一方、追加配布依存と書込bridgeが増える。既存Markdown WKを置くだけではBranchEditor完成にならない。実装総コスト・ライセンス・実増分サイズ・非同期配置と古い結果拒否を比較して接続方式を決める。現時点でWK/JSCの速度、実配布サイズ、実機操作性は未測定。


### 公式版への置換・配布境界の確認

3376d079で@dagrejs/dagre3.1.1と@dagrejs/graphlib4.0.5へ置換し、旧dagre/graphlib項目と自前型宣言を除去した。npm/Yarn両lockを揃え、通常treeは同じ算法を維持。切断cycle・自己loop・複数componentの採取結果ではnode/edge順と有限座標、サンプルpixel座標が旧版と一致した。関連6件/Web型検査/Vite build/frozen Yarn installは成功。yarn check --integrityは失敗。コピー元cacheのintegrityに現lockと旧lock双方にない105キーを確認したため既存不一致を含むが、失敗全体が既存由来と断定せず、lock全体の正規化は行っていない。

b2f5f976/6a345e4aで同じpure元のbranchLayoutと既存Web ensureBranchTreeStateのbranchEnsureを固定bridgeへ公開。ID/時刻はホストが供給し、flat変換の属性保持とraw値のnative復元は既存境界へ接続する。関連13件、型検査、bundle鮮度、macOS JavaScriptCoreの実呼出が成功。Dagre ESMが内包するGraphlibにもMIT本文・固定版来歴・実配布hashを付けた。独立Astraは共有元/配布境界の新規P2以上なし。固定bundleは944610から1024346 byteへ79736 byte増加した（licenseとbridgeを含む実file差）。これはapp全体や圧縮配布サイズ、実行速度/消費電力の測定ではない。native UIの接続・非同期処理・古い結果拒否は次の同機能一式で確認する。
## 2026-10-14：プロンプトCSVの依存境界

プロンプトライブラリの接続に先立つ独立Astraの限定監査では、Web既存PapaParse5.4.1の文字列parse/unparse再利用を条件付き採用可とした。installed・npm/Yarn lockの版/integrity一致を確認。package.jsonの範囲指定だけで固定済みとはせず、lockと生成provenanceを維持する。[公式Releases](https://github.com/mholt/PapaParse/releases)で保守継続を確認し、確認した[ReDoS advisory](https://github.com/advisories/GHSA-qvjc-g5vr-mfgr)の対象は5.2.0未満。公開照合は未発見問題の不存在を保証しない。

[公式API](https://www.papaparse.com/docs)のCSV文字列処理を共有し、WebのBlob/URL/documentによる保存とnativeのOSファイルI/Oは分離する。worker/download/File/Node-stream経路はnative共有入口へ持ち込まない。配布物へ固定版の[MIT本文・著作権](https://github.com/mholt/PapaParse/blob/master/LICENSE)を保持し、完成bundleの実JSC読込とCSV往復を採用条件とする。現段階は実装中で、native配布・プロンプト機能完成とは扱わない。
### native接続の採用条件確認

4bb71b7b/db7a353dで固定PapaParseのMIT本文と実source hashをbundleへ同梱し、実JSCによるCSVとnative保存境界を確認した。CSVのOS読込/書出しと共有変換はUI外へ分離し、取消/古いdraft/保存失敗の保全を確認。独立Astraの限定再監査は新規P2以上なし。証拠と実表示等の未確認範囲は[検証台帳](web-native-completion-ledger.md)に記録した。

## 2026-10-14：プロンプト検索の依存境界

次のnative prompt適用ではWebの既存match-sorter6.3.1をname検索に限定再利用する。独立Astraはinstalled/両lockの版一致、remove-accents0.4.2と既存修正版Babel runtime7.26.10への依存を確認。公式[match-sorter Releases](https://github.com/kentcdodds/match-sorter/releases)と[remove-accents](https://github.com/tyxla/remove-accents)を根拠に、MIT本文/著作権と実入力hashの配布保持を条件付き採用可とした。確認できた公開advisoryに両検索packageの該当を見つけず、[Babel advisory](https://github.com/babel/babel/security/advisories/GHSA-968p-4wvh-cqc8)は既存固定版で修正済み。未発見問題の不存在は保証しない。

検索経路はDOM/Node/network不要だが、同順位のlocaleCompareによる全Unicode順序一致をsource共有だけで保証しない。a90b5b8c/86fef754でMIT本文と固定hashを配布へ含め、完成bundleの実JSCで名前/同順位/アクセント、UI外検索と古い入力の拒否を確認した。独立Astraのquery同値性指摘はbb18b7f3でUTF8基準へ修正し、限定再監査は新規P2以上なし。実bundle増分22,935 byte。ESM等の原文約18.5KB、app全体/圧縮配布/実機性能とは区別する。適用の接続範囲と実UI等の未確認は[検証台帳](web-native-completion-ledger.md)に記録した。

## 2026-10-14：local分類器の採用境界と限定更新

独立Astraの採用前調査では、実Web Transformers.jsのpipeline/tokenizer/MultiFileManifestをWKWebViewとWorkerで再利用する小実証を第一候補とした。新classifier/tokenizerをSwiftで再実装しない。公式[ORT Objective-C API](https://onnxruntime.ai/docs/get-started/with-obj-c.html)と[Swift tokenizer](https://github.com/huggingface/swift-transformers/blob/main/README.md)は代替候補だが、tensor前後処理・tokenizer同値・追加依存・Catalyst配布確認の費用が加わる。CoreML事前変換だけへ絞ると既存ONNXモデル契約の対応範囲を縮小するため採用しない。CoreML/ANEの恩恵とWK/WASMの性能・消費電力は実測前に断定せず、実証で不足が分かった場合にnative ORT境界を検討する。判定閾値とhybrid規則は既存共有元に残す。

現固定HF4.0.1/ORT dev722743c0e2にはCPU TensorScatterの型制限[公式修正](https://github.com/microsoft/onnxruntime/pull/29916)が未適用だった。a78972ccで最小の対応HF4.3.0へ固定し、その公式ORT dev8d85527a0で修正の包含を確認した。HF4.1/4.2は修正前、4.3.1の追加機能は今回不要。新しい型定義のconst type parameterに対応するTS5.4.5を固定し、空のverification mapへ既存型だけを明示する。protobufjsはWebの実webgpu入口では非同梱だが、両lockとinstalledに配布される既知脆弱版を残さず7.6.6へ対象固定する。新規の直接依存は追加しない。独立Astraの版/integrity/公開advisory照合とP2修正確認は新規P2以上なし、未発見問題の不存在を保証しない。

WK実証ではORTのmjs/WASMも[公式配布手順](https://onnxruntime.ai/docs/tutorials/web/deploy.html)に従いローカルへ固定し、外部通信なし・実pipeline結果・取消/古い通知の拒否・Worker破棄を確認する。local_files_onlyだけではORT資産のCDN読込を止められない。Node版/sharpは同梱せず、固定ORT revisionのMIT本文とThirdPartyNoticesを保持する。Web実unloadModelはunload通知後にWorkerをterminateするため、workerのnull代入だけを見て解放規則を作り直さない。実分類、nativeのモデル資産管理・Local/Hybrid接続、実機性能はまだ完成していない。


### 2026-10-14：Web配置へのUI調整とモデル実行境界

UIはWebの会話上部（左モデル・右表示）、役割見出し/本文/末尾操作、composerのまとまりを優先してiOSへ寄せた。狭幅では操作Menuへの集約で44ptを維持し、時刻・強制カプセル・余白目的の固定高さは設けない。任意の吹き出し表示を保持する。広幅Catalyst実表示と独立Astraは確認済み、狭幅/最大文字サイズ/VoiceOver/iPhone、直接navigationやモデルdropdown等の残る配置差は完成扱いしない。

分類器は既存Web workerをWKClassifierHostで実行し、モデルファイルの供給・OSフォルダー取込・取消だけnative境界へ置いた。nested OPFSとrequired .part判定は実Web側を修正/共有した。新たなSwift分類規則・別言語移植・persisted rootを増やさない。次は実Web Local/Hybrid callerを根拠として共有localModeration/localPolicyへ本番consumerを接続する。詳細証拠と未確認範囲は完成ledgerの同日節を参照する。


### 2026-10-14：自動Local/Hybridの共有元とnative接続

実Webのmoderationモデル選択を抽出し、Web2callerとnativeで同じ元を利用する。既存threshold/policy/結果mutatorもそのまま共有し、Swiftはファイル供給・WK lifetime・通信/資格情報・atomic保存の接続だけを担当する。Webの準備失敗によるfallback未到達も同じ機能群内で局所修正した。nativeの方式Picker/Hybrid設定を接続し、任意の未知設定値を保持する。Catalyst境界と独立Astraは確認済み、実モデル/クラウド/全画面の未証明は完成ledgerへ残す。全機能再現と全I/O/実同期互換の最終条件は縮小しない。

## 2026-10-20：最新mainの共有接続と次の範囲

main a4d83db6の新同期wireをWeb実engineの共有実行へ取り込んだ。Swiftは暗号/HTTP/保存境界を維持し、wire・履歴・ID回復を別実装しない。Web worker/nativeの結合処理を共有し、未知属性とremote保持entryの意味を維持する。新形式のWeb→native→Web往復、認証済み不正deltaの拒否、保存/再起動の証拠は完成ledgerの同日節に記録した。

次はmainで増えたproxy状態/保存データ管理・永続node状態表示を実Web callerから接続し、業務規則は必要箇所だけ抽出する。旧Google保存のreadonly移行、実cloud互換性、狭幅/文字サイズ等のUI受入は引き続き残る。既存共有範囲の全面再設計やnativeへの再実装は行わず、機能群単位の検証と独立Astra監査を維持する。

同日の次機能群でproxy状態/保存データ管理を共有接続した。要求/応答・削除継続・受信位置gap・labelをWebから共有し、nativeは通信/資格情報/標準画面と既存journal復旧の接続を担当する。証拠と実接続/UIの未確認範囲は完成ledgerへ追記した。次は永続node状態表示と旧Google保存のreadonly移行を扱う。実cloud/全UI受入の完成条件は維持する。

続く機能群で永続streamStateの更新・表示・終了/復旧分類をWebから共有し、nativeの既存atomic保存とバブル表示へ接続した。未知raw値を保持し、要求IDによる古い復旧の拒否を有効にした。Astra指摘の空出力/journal保存順序を修正し、代表I/O/recordsと保全を確認した。次は旧Google保存のreadonly移行を扱う。実cloud・全UI条件は引き続き残し、完成ledgerの未確認範囲を縮小しない。
