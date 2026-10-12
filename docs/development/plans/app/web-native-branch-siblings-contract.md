# 段階2：兄弟一覧の共通契約

2026-10-12。[段階1](web-native-stage1-map.md)の最初の試行。製品関数は`src/utils/branchUtils.ts:getSiblingsOf`をそのまま使い、描画・状態更新・永続化は対象外。

## 共通の意味

入力は対象node IDと、順序の確定したnode集合。対象がなければ空一覧。対象があれば同じparentIdを持つnodeを、自分自身も含めて返す。null親はroot群。親nodeが集合内になくても同じ親IDの群を返す。rootId、activePath、role、本文、createdAtは選別・順序に影響しない。入力は変更しない。結果は読取り用で、オブジェクト参照の同一性は言語間の契約にしない。

正常入力の前提は、一意かつ非空のnode ID、map keyとnode.idの一致、parentIdがnullまたは非空ID。IDは通常UUIDを想定し、今回のfixtureでは整数様IDとUnicodeも扱う。JS継承プロパティと衝突するID、重複ID、欠落parentId、型不正等の外部入力検証は本関数の責務外。ここで安全なimportを保証しない。空文字親は正常入力に含めない。

## 順序と検証データ

言語に依存しないJSONは`tests/fixtures/web-native/branch-siblings.json`。versionはfixture形式の版。各caseはname、scope、nodeId、nodes、expectedIdsを持つ。nodesはmap投入前の順序付き配列で、id/parentId/createdAtだけを記す。これはテスト入力であり、新しい永続形式ではない。

Webの既存順序を維持するため、配列からnode mapを作った後の列挙順を使用する。具体的には、0〜4294967294の整数を先頭ゼロなし10進表記したkeyを数値昇順で先に、それ以外のkeyを入力配列順で後に並べる。`01`は後者、`4294967295`も後者。その順序から同じ親のnodeだけを選ぶ。createdAtで並べ替えない。

新iOSはSwift Dictionaryの列挙順を利用せず、同じ順序が確定した入力で比較する。実データの順序をどの保存・読取経路で保全するかはEの移行契約で別途決める。今回のfixtureだけで既存Web JSONからの順序保持や同期互換が完成したとは扱わない。

scope=sharedが新iOSでも満たす期待値。scope=web-observationは正常契約外のWeb現状を記録するだけで、iOSに移植しない。空文字親でWebがnull親rootを返す挙動をここへ隔離する。新iOSの不正入力拒否/修復はimport境界で別途決め、今回Web動作を変更しない。

## 接続と受入

`src/utils/branchSiblings.contract.test.ts`がJSONを読み、実関数へ渡す。role/contentHashはテスト用固定値、rootId/activePathは選別へ使わない値とする。全caseで期待ID順と呼出前後の入力一致を確認する。

欠損・単独・同親・複数root・孤立親・自己包含・非時刻順・整数様key・Unicodeを検証する。UIの前後切替、path計算、stream確定、undo、保存は別の接続検証であり、本テストで成立を主張しない。旧Swiftの自己除外/時刻順は本契約とは一致しない。

段階2時点ではiOS側は凍結中につき未実行だった。その後ユーザー承認を受け、下記Catalyst検証まで実施。Rust/WASM、ライブラリ依存、保存形式の追加はない。

## 実行・監査結果と方式判断

2026-10-12、`vitest run src/utils/branchSiblings.contract.test.ts src/hooks/useMessageBranchSwipe.test.ts`：2ファイル14件成功（shared 8、Web観測1、既存gesture 5）。`tsc --noEmit`成功。ブラウザE2EやiOSの実行結果ではない。

- 段階2：独立Astra Lowが契約・fixture・実ソースとの接続を監査し、新規指摘なし、受入可能。監査側はテストを再実行せず、上記実行結果と静的確認で判定。
- 段階3：既存関数が読取専用で、UI/store/I/Oへの依存を関数内に持たないため、追加変更なし。現在のcallerを維持する。監査でも新しいAPIや層を作らない判断は妥当とされた。utilsモジュール全体の分離やバンドル改善を達成したという意味ではない。
- 段階4：この対象へのRust導入は見送る。現状の製品修正箇所は0、新規実行時接続コード0、追加依存0で、検証のためのadapterだけで成立した。数行のfilterにFFIとビルド構成を加える利益は今回確認できない。速度・メモリ・配布サイズの比較測定は未実施で、性能優位は主張しない。Astraは見送り方針を妥当と判定。より大きい対象での共有方式評価とnative測定は保留し、段階4全体の測定完了とは数えない。
- 段階5：新規`ios-rebuild/`の隔離したCatalystアプリへ接続。共有8case、整数key境界、style/兄弟/会話選択の保持をXCTest 3件で検証し成功。Catalystビルド・起動成功。実UIで整列／吹き出し切替、A→B→Aと選択保持、端のボタン無効を確認。独立Astra Mediumは限定pilotを静的受入。nativeの実データ順序保全・保存・同期・iPhone/iPad実機は未確認で、段階5全体の保存までの受入完了ではない。

次の優先対象はEの交換形式・読取互換fixture。入力形式、保持すべきデータ、不正入力の扱いを先に絞り、別の段階2として監査する。保存形式変更や移行の実行をこの試行に含めない。
