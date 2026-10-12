# E：展開本文V3の読取契約

互換性の判定対象はI/O結果。内部表現・ローカル保存はネイティブに最適化し、Core Data等を採用してよい。外部データへの再出力で情報・参照・順序・意味を保つことを要求し、内部DBやメモリ表現の一致は要求しない。未互換時に止めるのは既存ユーザーデータの上書きと本番同期であり、隔離データでの内部保存の実装・検証は先行できる。

2026-10-12。[段階1](web-native-stage1-map.md)のEを、JSON交換ファイルの読取りに限定して先行する。製品関数・保存形式・同期・iOSコードは変更しない。以下の「仕様」は新iOSと共有する正常入力の狭い範囲、「Web観測」は既存実装の結果であり、受入仕様への格上げではない。

最終受入条件はデータ形式とオンライン同期方式の完全互換である。Web現行の交換・同期payload、envelope、record、暗号パラメータ、競合処理の意味を新iOSでも維持する。今回の対象外項目は段階的な調査・検証の範囲を示すだけで、将来の非対応を許容しない。未知・未対応項目を捨てて書き戻さず、旧iOS独自形式の保存データにも無損失で引き継ぐ経路を必要とする。全項目の互換と保持を検証するまでは新iOSから既存ユーザーデータへの上書き・本番同期書込みを開始しない。

## 仕様：今回扱う入力

- 数値`version: 3`のJSON objectで、`chats`は配列、`folders`と`contentStore`はobject。内部storeのversion 18やCloudKit snapshotの版とは別物。
- chatはID・タイトル・titleSet・messages・config・imageDetailと任意のfolderを持つ。branchTreeがある場合、node map、rootId、activePathと全nodeのcontentHash参照が整合している。親子・root・activePathの整合、map keyとnode.id一致、一意IDを正常入力の前提とする。inactive nodeの本文も欠損させない。
- contentStoreの各entryは展開済み`content`配列と数値refCountを持ち、deltaを含まない。本文はtext、image_url（url/detail）、reasoning、tool_call（id/name/arguments）、tool_result（tool_call_id/content）。文字列・順序・改行を保持する。画像URLの実在やtool argumentsの意味までは検証しない。
- nodeのid/parentId/role/contentHash/createdAt/label/starred/pinned、chatのcollapsedNodes/omittedNodes/protectedNodes、folderのid/name/order/expandedを保持対象に含める。兄弟順序は[兄弟契約](web-native-branch-siblings-contract.md)を参照する。
- 交換データのchat IDと、append先で衝突を避けるために割り当てるchat IDは区別する。Web importは正常入力でも新しいchat IDを割り当てる。system prompt正規化でtree/messages/configが変わる入力は今回の正常fixture外。
- 未知version、不正構造、欠損本文参照は正常入力として受け入れない。入力と既存の保存データを保持し、破棄を前提にしない。delta付き内部データはこの展開本文V3契約の外側に置く。

この仕様は完全なimport validatorの実装・認証ではない。評価結果・評価設定、system prompt正規化、ID衝突、全グラフ整合、configの全オプションは保持すべき後続対象であり、今回の正常fixtureで網羅済みとは扱わない。

## Web観測：実関数の境界

| 入力 | validateExportV3 | importChatFromFile（append） | 本文読取 |
| --- | --- | --- | --- |
| 正常な展開本文V3 | true | 成功、chat ID再割当 | 五種の本文とmetadataを保持 |
| 上記のversionだけ99 | true | version判別で失敗 | 対象外 |
| contentStoreのtextが数値 | false | 失敗 | 対象外 |
| active nodeのcontentStore entry欠損 | true | 成功 | resolveContentは空配列 |
| activePathのnode欠損 | false | 失敗 | 対象外 |
| delta、基底あり、空patch | true | 成功 | 基底本文を展開 |
| delta、基底欠損 | true | 成功 | 警告を出して空配列 |
| delta、不正patch text | true | 成功 | resolveContentは例外を投げる |
| nodes=null、非空activePath | 例外 | 失敗を返しsnapshot復元 | 対象外 |
| inactive nodeの本文参照欠損 | true | 成功 | active本文は読めるがinactive本文は空配列 |

`utils/import.ts`のvalidatorはversion値を検証しない。branchTreeはnodesのtypeof、activePath配列とそのnodeのcontentHash文字列を確認するだけで、contentStore参照・非active node・root/親子・ID一致は検証しない。contentStoreでは本文の形とrefCountの型を確認するが、deltaフィールドは検証しない。chat.messagesは配列内の本文型を検証せず、文字列本文をtext配列へ変換する。configやchat IDも補完するため、validatorは入力を変更し得る。

`components/ImportExportChat/importService.ts`がversion 1/2/3を先に判別し、V3ではvalidator後にfolder/contentStoreをmergeしてchat IDを再割当する。同hashで本文または未知metadataが異なるentryは別名へ退避し、取込nodeとdelta基底の参照を更新する（後続修正済み）。同一entryのみrefCountを加算する。system prompt正規化の例外は警告に留め、import成功にできる。このため不正deltaでもimport成功と本文読取成功は一致しない。公開入口は失敗時snapshotを復元するが、本テストはmock storeでのappend経路であり、実DBへのrollbackやreplace経路の証明ではない。

`utils/chatExport.ts:prepareChatForExport`は参照されたentryのdeltaを展開し、deltaを出力へ残さずrefCountをnode参照数へ再計算する。欠損entryは出力storeから省かれ、messagesの欠損本文は空配列になる。不正patchの展開は例外を投げ得る。正常V3を作る関数という名称だけで、壊れた入力から完全な交換データができるとは保証しない。

## fixtureと接続

`tests/fixtures/web-native/exchange-read.json`のversion 1はfixture形式の版。10caseは各々独立したpayloadと、手定義のspec（accept/reject/outside-expanded-v3）、observed（validator、importSuccess、resolvedBodyまたはresolveThrows、inactive nodeと本文・export entryの期待値）を持つ。Web実装から期待値を生成しない。spec=rejectなのにobserved.importSuccess=trueのcaseは、共有受入仕様と現状の隔たりを記録する。

`src/utils/exchangeRead.contract.test.ts`はJSONを読み、実validateExportV3、実importChatFromFile、実resolveContent、実prepareChatForExportへ接続する。storeとFileReaderのみテスト用に置換し、製品の読取関数はmockしない。失敗時のmock状態復元と既存entry保持を確認する。正常caseは五種の本文、tree、node flags、chat node状態、folderを比較する。別hashのinactive nodeとその本文を正常caseに含め、import後の保持と、その状態からexport準備後のnode・本文entry保持を手定義期待値と比較する。inactive欠損caseもnodeの保持、absent参照の空配列、export時の欠損entry省略を確認する。deltaは有効基底と空patchの最小例であり、非空patchのアルゴリズム一般を検証するfixtureではない。

## 旧iOSと次の範囲

旧`ios2/.../Domain/Services/ExportImportService.swift`は数値version>=3をV3扱いし、contentStoreがあれば独自のV2判別も行う。Webの厳密な1/2/3判別とは一致しない。旧ExportV3はfoldersをoptionalとして省略でき、evaluationSettings/evaluationResultsを持たない。旧ContentEntryのcontent/refCountだけでWeb deltaを展開できると扱わない。旧iOSの実装構造を維持する必要はないが、独自形式を含む既存保存データは無損失で引き継ぐ。これらの判別・欠落挙動を新iOSの正解として流用しない。

新iOSは正常fixtureの本文・分岐・node状態・folderを保持し、上記Web観測の欠損許容を模倣しない。次は評価情報とsystem promptを含む保持項目、version/グラフ/参照整合の入力判定、保存成功前の元データ保持を追加の読取fixtureで確定する。ローカル保存移行、delta内部保存、CloudKit record/WVLT・圧縮形式、競合処理と書込みは別途扱う。詳細な移行設計・データ変換は今回行わない。

2026-10-12、`vitest run src/utils/exchangeRead.contract.test.ts src/utils/import.test.ts src/components/ImportExportChat/importService.test.ts src/utils/chatExport.test.ts src/utils/contentStore.test.ts`：5ファイル62件成功（新規10件）。`tsc --noEmit`成功。初回はmock storeが復元時のaction関数も保存したため新規caseに失敗し、mockの対象fieldを限定して再実行した。基底欠損と不正patchの警告は観測対象の既存挙動。

iOS、ブラウザ操作、実DB、同期、保存・置換は未実行。独立監査のinactive保持検証不足を上記fixture/assertで修正した。独立Astraが再監査済み。ここでの成功は完全互換の一部検証であり、既存ユーザーデータへの上書き・本番同期書込みの開始条件は満たしていない。

独立Astra Medium監査：inactive node/本文の保持検証不足1件を修正し再監査で指摘解消、新規なし。これは限定した段階2の受入であり、全I/O互換の完成ではない。
