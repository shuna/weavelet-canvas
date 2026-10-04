# OpenRouter 拡張の基本コンセプトと詳細設計

2026年10月4日。設計・実装完了。Astra Mediumによる基本コンセプト監査を反映した。アプリ実装、ビルド、実APIによる検証は未実施。

Chat Completionsを維持し、会話ごとのチャット設定とデフォルトチャット設定にOpenRouterの接続先、入力キャッシュ、回答キャッシュを追加する。保存用設定を送信直前にAPIのbodyとheaderへ変換する。既存の履歴管理とMarkdown描画を利用し、ツール呼出し、Responses API移行、履歴の自動要約は今回の対象にしない。

対象は`src/`のReactアプリ、Electron、および共通送信経路と任意のstream proxy。ユーザー指定により、凍結中のSwift実装は互換対応・検証も含めて今回の対象外とする。

## 基本コンセプト

### 設定の単位と初期値

OpenRouter用設定の現在値は`ConfigInterface.openRouter`にまとめ、既存の推論設定と同様にモデル・接続サービス・ローカル／リモートの組み合わせごとに保存・復元する。モデルやendpointによって適用できる項目が異なるため、モデル切替先へ現在値を一律継承しない。API接続サービスを表す既存の`providerId`と、OpenRouter内部の提供事業者を表す`provider`を区別する。

デフォルト設定は現在のモデル設定とモデル別の保存値を新規会話の作成時にコピーする。既存会話へ遡及適用せず、送信時に最新デフォルトとの動的な合成もしない。会話複製ではモデル別設定もコピーし、新しい会話IDを利用する。分岐は同じ会話の設定を共有する。

未設定の古い会話は従来の送信を維持する。新規会話のアプリ初期値では回答キャッシュを明示的にオフにする。旧データの未指定を勝手に明示オフへ移行しない。

### キャッシュと履歴

入力キャッシュは再利用可能な入力部分の処理を再利用し、回答は毎回生成する。回答キャッシュは同じ要求の回答自体を再利用する。キャッシュは履歴をモデルへ送る代わりにはならない。

送信範囲、Omit、システム指示、整形、トークン上限調整の順序を維持する。Protectは誤削除の防止であり、APIコンテキストの保持を保証する機能へ変更しない。キャッシュのために除外済みメッセージを送ったり、保存履歴を書き換えたりしない。

会話単位の`session_id`は経路継続とOpenRouterのLogs上でのグループ化に使用する。履歴保存、接続先の完全固定、キャッシュヒットを保証するものとして説明しない。手動の提供事業者順序はsticky routingより優先される。[入力キャッシュ仕様](https://openrouter.ai/docs/guides/best-practices/prompt-caching)

### Markdownと構造化出力

現行`MarkdownRenderer.tsx`はReactMarkdown、GFM、数式とKaTeXを利用する。JSON Schemaの`{ markdown: string }`はJSONの外形を制約するだけで、文字列内部のGFMや数式が正しく描画されることを保証しない。JSONを途中まで受信した場合の表示、停止、回復、履歴への変換も別途必要になる。

したがって通常のMarkdownテキスト生成を維持し、今回の設定に構造化出力を追加しない。既存システム指示欄で対応書式を指示できる。MarkdownのASTを新設したり、任意JSON Schema編集画面を加えたりしない。将来、表や項目の固定構造をアプリが実際に利用する要求が生じた場合に限定して再検討する。[構造化出力仕様](https://openrouter.ai/docs/guides/features/structured-outputs)

## Astra Mediumの基本コンセプト監査

判定は条件付きで採用可。監査は読み取りのみで行われ、詳細設計自体の独立監査や実API検証は行っていない。

| 指摘 | 詳細設計への反映 |
| --- | --- |
| `api.ts`はconfigの残余プロパティをbodyへ展開する | `openRouter`を必ず取り除き、OpenRouter宛てだけ専用のAPI項目へ変換する |
| タイトル生成は会話設定をコピーし、評価は独立bodyを使う | キャッシュ設定は本文回答に限定し、許可先やデータ方針などの制約は会話内容を送る補助処理にも適用する |
| 回答キャッシュの未指定と明示オフが異なる | `inherit`、`off`、`on`を区別する |
| requestのZDRはOpenRouterの回答キャッシュを禁止しない | ZDRを有効にした要求ではアプリ側で回答キャッシュもオフにし、全経路無保存とは説明しない |
| 順序指定とsticky routing、TTLの意味は同一ではない | 優先順序を明記し、初期の明示入力キャッシュはClaudeに限定する |
| 会話設定とデフォルト設定は全体レイアウトを共有していない | 追加するOpenRouterフィールド部品だけ共有する |

ユーザーのモデル別設定指示を受けた追加のコンセプト監査では、旧snapshotの欠落を明示的な`undefined`へ正規化すること、取得・復元時にもネストした設定を独立コピーすること、制約付き補助送信の不明な適用可否を送信前に判定することが指摘された。以下の設計へ反映している。

## 保存する設定

次の型は設計案であり、この文書でコードへの追加は行わない。APIと同じ意味のrouting項目は同じ名前にし、キャッシュとセッションはアプリの設定として保持する。

```ts
interface OpenRouterChatSettings {
  routing?: {
    order?: string[];
    only?: string[];
    ignore?: string[];
    sort?: 'price' | 'throughput' | 'latency';
    allow_fallbacks?: boolean;
    require_parameters?: boolean;
    max_price?: { prompt?: number; completion?: number };
    data_collection?: 'allow' | 'deny';
    zdr?: boolean;
  };
  promptCache?: {
    mode: 'provider-default' | 'claude-conversation' | 'claude-system';
    ttl?: '5m' | '1h';
  };
  responseCache?: {
    mode: 'inherit' | 'off' | 'on';
    ttlSeconds?: number;
  };
  stickySession?: boolean;
}
```

`openRouter?: OpenRouterChatSettings`を`ConfigInterface`と`ModelSettings`へ追加する。前者は選択中モデルの現在値、後者は既存`modelSettings`マップ内の保存値であり、別の永続化マップは作らない。

`src/utils/modelSettings.ts`の既存キー`[remote/local, providerId, model]`と`pickModelSettings`／`savedModelSettings`／`switchConfigModel`を拡張する。切替前のOpenRouter設定を現在モデルのsnapshotに保存し、切替先に保存値があれば復元、なければそのモデル用の初期値を使う。異なるモデルのrouting、入力キャッシュ方式やTTL、回答キャッシュ設定を流用しない。既存snapshotに`openRouter`が欠落している場合は旧データとして未指定のままにし、旧データと新規初期値を区別する。

復元関数は旧snapshotにも`openRouter: undefined`を明示的に含める。現在configへ保存値をspreadする既存方式では、キー自体がないと元モデルの値が残るためである。未設定の切替先がOpenRouter以外の場合も明示的に現在値を消す。

OpenRouter以外のモデルの現在値は未指定にし、OpenRouterモデルのsnapshotは残す。同じモデルを別のAPI接続サービスで使う場合にも設定を分ける。接続先URLの変更だけでは既存キーが変わらないため、その時点で適用能力を再評価する。

配列、ネストした設定を変更するときは新しい値を作り、デフォルトと会話の間で可変オブジェクトを共有しない。snapshot取得・復元・新規会話生成・複製時には現在値とモデル別snapshot内のOpenRouter設定を独立コピーする。新規ライブラリは不要。

既存の`isSameConfig`比較には`openRouter`を追加する。設定の各編集がimmutableであれば参照比較を利用できる。UI側とstore側の両比較、popup保存、inlineの終了時保存、会話設定の自動保存、リセット、モデル切替のconfig再構成をすべて対象にする。

旧データのフィールド欠落は有効な状態とする。明示的な新既定値は`responseCache.mode = off`、`stickySession = true`、入力キャッシュとroutingは未指定とする。欠落した`stickySession`は従来動作、すなわちアプリからのID指定なし。入力値検証はUIだけでなく保存データから送信する境界でも行う。

## 設定画面

会話設定の`ConfigMenu`と、デフォルト設定の`ChatConfigPopup`／`ChatConfigInline`に同じOpenRouter設定部品を配置する。既存画面全体の統合は行わない。

OpenRouter選択時だけ編集可能な「OpenRouter」グループを表示する。他接続先ではモデル別snapshotを破棄しない。両画面に「選択中のモデルの設定」を表示し、デフォルト画面には「新しい会話に適用」も表示する。

表示・送信の適用可否は推論や画像入力の既存能力判定と同じ場所でモデル／接続サービスを参照する。既存の画像設定の保存単位や推論の動作を今回変更しない。`ProviderModel`にOpenRouterの`supported_parameters`を任意で保持し、既存モデル一覧の正規化で捨てないようにする。新しい汎用能力管理層は作らない。モデル一覧にある対応情報はendpoint全体の保証として扱わない。

項目ごとに対応、非対応、不明を区別する。既知の非対応項目は編集不可で理由を表示し、新しい明示値を送らない。不明は「対応未確認」と表示し、対応済みのbadgeを付けない。ユーザーが不明な項目を明示選択した場合はOpenRouterの検証結果を利用し、失敗時に指定を削除して再送しない。既存保存値が能力変更で不適合になった場合は保存値を破棄せず、送信前に訂正が必要な項目を表示する。

routingと回答キャッシュはOpenRouter層の機能だが、提供先候補、価格、指定条件の成立はモデルごとに異なる。入力キャッシュ方式とTTLはモデル／提供先の対応範囲をさらに判定する。将来構造化出力を追加する場合も、推論設定と同様にモデルごとの保存と対応判定を前提とする。

| 項目 | UIと動作 |
| --- | --- |
| 接続先の選び方 | 自動、料金、速度、応答待ち時間、指定順。指定順は`order`、他の選択は`sort`。UIでは同時指定しない |
| 許可する提供事業者 | 順序付きslug入力。空欄は制限なし。単一指定なら特定先への限定になる |
| 除外する提供事業者 | slug入力。モデルの作者名と実際の提供事業者slugを混同しない説明を付ける |
| フォールバック | OpenRouterに任せる、許可、禁止。未指定とfalseを区別する |
| パラメータ対応を必須にする | OpenRouterに任せる、必須、必須にしない |
| 入力・出力の料金上限 | それぞれUSD／100万token。空欄は未指定。0は無料のみという有効な値 |
| データを保持し得る提供先 | OpenRouterに任せる、許可、禁止 |
| ZDRの提供先を必須にする | 未指定またはtrue。アカウント側のZDRを解除するfalse操作は設けない |
| 入力キャッシュ | 提供先に任せる、Claude会話全体、Claudeシステム指示。Claude指定時だけ5分／1時間を表示 |
| 回答キャッシュ | OpenRouterに任せる、オフ、オン。オンの場合のみTTL秒を編集。初期300秒 |
| 会話単位の経路継続 | オフ／オン。内部IDを入力する画面は設けない |

slugはtrimし空要素と重複を除くが、大小文字を推測で変換したり、提供先名からslugを推定したりしない。`order`／`only`と`ignore`に同じslugがある設定、`only`に含まれない優先先は保存前に訂正を求める。配列の順序を勝手に変更しない。第一段階では選択候補取得用の新APIは加えず、slug入力と公式資料へのリンクで設定する。

料金上限は有限の0以上、TTLは整数1〜86400。空欄と0を区別する。保存値が不正な場合は送信前に設定エラーとして表示し、制約を削除して送信しない。

OpenRouterのアカウント設定も適用され、会話設定で必ず緩和できるわけではない。`only`はアカウントの許可先をさらに絞り、料金上限は要求全体の支払上限ではなく提供先の単価条件である。適合先がない場合に条件を外して再送しない。[接続先制御仕様](https://openrouter.ai/docs/guides/routing/provider-selection)

## 送信直前の変換

`api.ts`に設定からbody／headerへの変換を一か所設け、通常応答、直接stream、`prepareStreamRequest`が共用する。既存API全体を新しい汎用クライアントへ置き換えない。追加helperは同ファイル内でよい。

保存用の`openRouter`はconfigのrest展開から必ず取り除く。適用判断にはモデル解決後の接続サービスを使用し、未解決の`config.providerId`だけに依存しない。解決された接続サービスがOpenRouterの場合に限り、routingをbodyの`provider`へ変換する。実際のURLとの整合も確認し、OpenRouter以外への専用設定送信は行わない。

会話IDと要求用途は実行時引数として渡す。要求用途は本文生成、再生成、タイトル、品質評価の必要な区別だけでよく、保存configへ混ぜない。要求単位のランダムIDや時刻をAPI bodyへ追加しない。同一要求のJSON項目順序を固定し、通常応答とstreamの違い以外でbodyを無用に変えない。

body変換は履歴選択と上限調整の後に行い、入力配列を直接変更しない。通常Markdownと画像のcontent構造を維持する。

### 入力キャッシュ

初期の明示制御は、Claudeモデルに対する次の二方式に限定する。OpenAI、Gemini等の既存自動キャッシュは「提供先に任せる」で維持する。万能な入力キャッシュ無効化、TTL横断変換、独自キャッシュサービスは追加しない。

- `claude-conversation`はトップレベル`cache_control: { type: ephemeral }`を追加する。1時間を選んだ場合は`ttl: 1h`を追加する。
- `claude-system`は最終送信配列に残っているsystemメッセージの最後のtextブロックへ同じ`cache_control`を追加する。systemが上限調整で消えた場合や空の場合は送信前エラーとし、他の履歴を代わりにキャッシュ対象にしない。
- 非Claudeへのモデル切替では、切替先の保存値または初期値を使うためClaude設定を継承しない。import等で非ClaudeモデルにClaude設定が入っていた場合は設定不適合として送信前エラーにする。値を黙って落として有効な設定と表示しない。

明示設定による対応先の選択・除外はOpenRouterへ委ねる。unsupported応答が返ったら設定エラーを表示し、キャッシュ指定を外して再試行しない。最低長、料金、実際のヒットはモデル／endpoint次第であり、有効化とヒットを区別する。仕様・能力の変更をモデル名だけから推測して常時保証しない。

### セッション

`stickySession = true`では`session_id = weavelet:<chatId>`を使用する。タイトルと評価は本文と混ぜず、必要な場合だけ`:title`／`:quality`のsuffixを付ける。proxyの`chatId:requestId`やアプリの生成session IDとは別の値である。分岐では共通、別会話や複製では別IDになる。IDをresetする新しい操作は加えない。

### 回答キャッシュ

| 設定・操作 | 送信header |
| --- | --- |
| inherit | キャッシュ用headerを送らない |
| off | `X-OpenRouter-Cache: false` |
| on | `X-OpenRouter-Cache: true`と`X-OpenRouter-Cache-TTL` |
| onで明示再生成 | 上記に`X-OpenRouter-Cache-Clear: true`を追加 |
| inheritで明示再生成 | キャッシュ用headerを送らず、通常送信と同じ設定を継承する |
| ZDR指定あり | 回答キャッシュは実効off。on／inheritの指定と併用させない |

再生成は新しい回答を求める操作として扱う。onの場合は該当キャッシュ一件を更新し、全キャッシュ削除は行わない。preset側の明示offは要求のonより優先するため、オン表示は「要求した設定」でありヒット保証ではない。[回答キャッシュ仕様](https://openrouter.ai/docs/guides/features/response-caching)

ZDRと回答キャッシュonの併用は保存時にエラーにする。外部データから矛盾が来た場合も送信前にエラーにし、設定の一部を黙って変更しない。ZDRを必須にする操作時には回答キャッシュoffへ変更する内容をその場で表示する。requestのZDRとアカウントZDRは同義ではなく、アプリの保存履歴やstream proxyによる回復用保存にも別途データが残る。

## タイトルと評価の扱い

会話本文を外部へ送る補助処理が制約を迂回しないようにする。適用表は次のとおり。

継承する制約の起点は、その要求で選択している本文モデルの現在値である。別の本文モデルのsnapshotや別のタイトルモデルに保存された値を合成しない。モデル別設定への切替によって制約も変わることをUIに明記する。会話全モデルに共通の新しいポリシー階層は追加しない。

| 設定 | 本文生成 | タイトル・外部品質評価 |
| --- | --- | --- |
| `only`、`ignore`、料金上限、`data_collection = deny`、`zdr = true` | 適用 | 同じ会話の内容を送る要求へ適用 |
| 優先順、sort、fallback、require_parameters | 適用 | 独立した補助モデル設定を維持し、無条件継承しない |
| 明示入力キャッシュ | 適用 | 継承しない |
| 回答キャッシュ | 会話設定に従う | 明示off |
| session_id | 会話ID | 別suffixまたは未指定 |

制約がある会話で、補助処理の送信先がOpenRouter以外、制約を表現できないAPI、またはAPIが制約を強制できるか不明なら、その補助処理は送信前に止めて理由を表示する。既知のOpenRouter APIへ正しい制約を送れる場合、適合する提供先の存在確認はサーバーへ委ね、候補がなければエラーを受け取る。接続先やモデルを勝手に変更しない。制約のない会話の通常の他社タイトル生成を止めない。タイトル失敗で本文回答を破棄せず、評価は未実施またはエラーとして表示する。

補助先に独自の制約がある場合は、元会話側と共通して満たせる条件だけを採用する。許可先は共通部分、除外先は合計、料金上限は低い方、データ禁止とZDRは厳しい方を使い、補助側の設定で元制約を緩めない。

外部の安全性評価も会話内容を送るため同じ事前制約確認が必要である。安全性評価に必要な制約を適用できない場合、既存の評価方針を勝手に緩和して本文生成を続けない。既存の非ブロッキング評価処理に合わせて、事前に制約との適合を確認する。ローカル評価にはOpenRouter項目を渡さない。

`generateTitleForChat`のconfig丸ごとコピーを用途に応じた変換へ変更し、`runQualityEvaluation`には適用対象の制約だけ渡す。安全性評価の接続先・要求形式も実装時の対象に含める。UIには「許可先・料金上限・データ方針は会話内容を送る補助処理にも適用」と明記する。

## 応答の利用量とキャッシュ表示

キャッシュ設定と実績を分けて表示する。要求した設定からヒットを推定しない。

本文生成の結果に、generation IDとともに任意のAPI観測値を付ける。`usage.prompt_tokens_details.cached_tokens`、`cache_write_tokens`、APIの入力・出力token、cost、および回答キャッシュの応答headerを利用する。0は正当な値として保持し、欠落と区別する。

直接streamの`getChatCompletionStream`は現在bodyだけを返すため、既存の戻り値を大きく変えず、任意の応答metadata callbackを追加する。非streamも同じcallbackを使える。SSEでは`choices`が空のusage専用eventを取りこぼさないよう、content処理より先にusageを取得する。

proxyではOpenRouterから取得したキャッシュheaderだけを既存の終了metadataに追加し、回復用snapshotにも残す。SWはそれを終了通知へ転送する。新しい独自SSEイベント方式は作らない。途中停止でも得られた観測値を保持し、未取得なら「不明」とする。ブラウザがCORSでheaderを公開していない場合も、MISSやoffと推測しない。

API観測値は既存の会話ノードmetadataとstream回復記録へ追加する。50件上限の`verifiedStats`だけを唯一の保存先にはしない。既存の`/generation`取得による検証値は維持し、追加ポーリングは行わない。実API値、後から検証した値、ローカルtoken推定を区別する。

表示する実績は「入力キャッシュ読込み」「書込み」「回答キャッシュ HIT／MISS／不明」。必要な場合だけ保持残り時間と元generation IDを詳細表示する。HITの課金tokenは0でも回答本文は存在する。本文tokenのローカル推定を課金tokenへ加算しない。既存の`cache_discount`は継続して利用する。

## 保存と同期

React側の設定、会話複製、export／import、IndexedDB、クラウド同期で`openRouter`が往復することを確認する。フィールド欠落を受け入れるため一律の既存会話書換えは不要だが、現在のmigration／import正規化が新フィールドを除外していないかは実装時に確認する。

## 実装する箇所

| 箇所 | 最小の変更 |
| --- | --- |
| `src/types/chat.ts`、`src/constants/chat.ts` | ConfigInterface／ModelSettingsの任意設定、新規会話既定値、snapshotを含む独立コピー |
| `src/utils/modelSettings.ts` | 現在値の保存、切替先の復元、未設定モデルと旧snapshotの区別 |
| `src/api/providerModels.ts`、`src/types/provider.ts`、既存能力参照 | supported_parameters保持、モデル／接続先別の適用可否 |
| `src/store/config-slice.ts` | 設定変更比較 |
| `src/components/ConfigMenu/ConfigMenu.tsx` | 会話用の状態、保存、モデル切替での保持 |
| `src/components/ChatConfigMenu/ChatConfigMenu.tsx` | デフォルトpopup／inline双方の状態、保存、比較、リセット |
| `src/components/ConfigMenu/OpenRouterFields.tsx` | 追加項目だけ共有する部品。新設候補 |
| `src/api/api.ts` | body／header変換、接続先判定、応答metadata callback |
| `src/hooks/useSubmit.ts`、`src/hooks/submitRuntime.ts` | 会話ID・再生成用途、usageとmetadata、補助送信の事前適合確認 |
| `src/hooks/submitHelpers.ts`、`src/hooks/useEvaluation.ts`、`src/api/evaluation.ts` | タイトル・外部評価への制約適用 |
| `proxy-worker/src/index.ts`、`public/sw-stream.js`、既存SW／proxy client型 | 応答metadataの終了通知と回復 |
| 会話ノードmetadata、`src/utils/streamDb.ts`、既存統計表示 | 観測値の保存と表示、課金0の保持 |
| `public/locales/` | 既存の翻訳方針に合わせた文言 |

モデル候補取得API、能力管理フレームワーク、新しい永続化層、任意schemaエディタ、provider別SDKは追加しない。応答metadataを取り出すためだけにprovider専用の別送信経路を作らない。

## 受入条件と検証

設計段階ではソース・公式資料と文書差分を確認する。以下の実行検証は実装後にまとめて行い、この文書の作成時には実施しない。

1. 会話設定、デフォルトpopup、デフォルトinlineで同じ項目を編集でき、再表示・再起動後も保持される。新しいデフォルトは既存会話を変えない。
2. OpenRouter以外のAPI body／headerへ設定が漏れず、ローカル生成も従来どおり動く。古い会話の要求は従来と同じになる。
3. モデルAで設定→Bで別設定→Aへ戻るとAの値が復元される。同じモデルの別接続サービス、未設定モデルへの切替でも前モデルの値が混ざらない。会話複製、分岐、export／import、クラウド同期でモデル別snapshotも保持される。複製のsession_idは元会話と異なる。
4. 通常応答、直接stream、proxy、SW＋proxyで同じ設定が送られる。routingのfalse、価格0、TTLの境界値が正しく扱われる。
5. Claude会話／systemの指定が送信コピーにのみ付く。Omit対象を送らず、上限調整後の存在しないsystemへマーカーを付けない。非対応モデルの明示設定はエラーになる。
6. 回答キャッシュのinherit／off／on、TTL、明示再生成が表のとおり動く。preset優先、同時MISS、TTL前のevictionを保証外として扱う。
7. キャッシュHITの課金0を保存・表示し、usageが欠落した場合と区別する。usage専用SSE、回復、途中停止を扱い、本文のローカル推定と課金を混同しない。
8. タイトル・評価が許可先やデータ方針を迂回しない。適用できない補助処理は送信前に止まり、未実施が表示される。安全性評価の方針を無断で緩和しない。
9. Markdown、数式、画像、停止、再生成、分岐の表示を既存経路で維持する。
10. 両設定画面でモデル別の対応／非対応／不明を同じように表示する。対応情報やendpoint変更で不適合になった保存値を破棄せず、送信前に示す。既存の推論・画像設定の表示と動作を維持する。

関連テストは既存の`api.test.ts`、`submitHelpers.test.ts`、`submitRuntime.test.ts`、modelSettings／保存関連のテストへ追加し、OpenRouter設定部品の保存経路だけ最小のUIテストで確認する。実装後に関連テスト、TypeScriptビルド、diff確認を一回まとめて実施する。proxy変更にはproxy側型チェックを加える。

有料APIの実動作確認では、小さなテスト会話で通常応答／stream、キャッシュMISS→HIT、再生成、適合先なしを確認する。入力キャッシュの最低長と料金を確認してから送信し、静的確認・mockテストと実APIの結果を分けて報告する。実施の可否と使用モデル／上限は実装時に確定する。

## 根拠と未確認事項

ソース上の根拠は`api.ts`のconfig展開、三つの要求関数、`generateTitleForChat`の設定コピー、`runQualityEvaluation`の独立body、両設定UIと比較関数、`MarkdownRenderer`、proxyの終了通知である。

未確認事項は、各endpointの実際の入力キャッシュ対応、CORSによるheader公開、回答cache HIT時のgeneration統計、外部安全性評価の制約適用範囲、import／同期の全往復。これらを検証済みとは扱わない。

- [OpenRouter Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter Prompt Caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [OpenRouter Response Caching](https://openrouter.ai/docs/guides/features/response-caching)
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter Responses API](https://openrouter.ai/docs/api_reference/responses/overview)


## 実装後の監査と検証（2026年10月4日）

Astra Mediumの独立監査で、末尾再生成のfresh指定欠落、Service Workerの本文／観測保存競合、SWなしproxy経路の観測保存先欠落を修正し、同じ3点の静的再確認で残存なしとなった。

- 関連10ファイルの137テスト成功。設定の変換・分離、旧snapshot、補助送信制約、0と欠落の区別、Service Workerの同時保存を含む。
- Chromeのブラウザテスト1件成功。会話設定の保存、モデル切替時の分離と復元、Claude以外のcache選択肢の無効化、ZDRと回答cacheの連動、デフォルトinline終了時の保存を確認。
- アプリのTypeScriptチェック、本番ビルド、proxyの型チェック、差分の空白検査成功。ビルドには既存のBrowserslist／chunkサイズ警告がある。
- `submitRuntime.test.ts`は19件成功、ローカルprompt構築の1件が失敗。同じテストを変更前のHEADソースで実行して同じ失敗を確認したため、今回の変更とは分離して扱う。
- 有料のOpenRouter実API、proxyのデプロイ、再起動を伴う全保存経路の手動往復は未実施。実際のcache MISS→HIT、provider別入力cache対応、CORS公開や請求値の実測は未検証。

Swift実装は変更していない。構造化出力とツール呼び出しは今回の対象外。


### 再生成時の未指定設定（2026年10月4日修正）

未指定・inheritの回答キャッシュ設定は再生成でも継承し、`X-OpenRouter-Cache: false`へ変換しない。明示onの再生成だけClearを送る。ブラウザの実API接続を無効なテストキーで確認し、未指定の通常送信は401まで到達、従来の再生成は追加CacheヘッダーでCORS失敗、修正後の再生成は通常送信と同じ401まで到達した。

OpenRouterの現時点のCORS応答はCache系要求ヘッダーを許可していない。明示on/offのヘッダー制御はこの外部制約の影響を受ける。直接／proxy経路で設定を削除・変更して迂回する対応は行わない。
