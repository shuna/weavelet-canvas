# Virtuoso 廃止プラン

## 概要
`react-virtuoso` を廃止し、プレーンな `overflow-y: auto` コンテナ + ネイティブスクロールに置き換える。
仮想化が必要になった場合は `@tanstack/react-virtual` を後日導入する。

Virtuoso 廃止に伴い、Virtuoso の API に合わせて構築されていたスクロール管理ロジックを
ブラウザネイティブの仕組み（`overflow-anchor`、scroll イベント）で置き換え、大幅に簡素化する。

---

## 設計方針: スクロール管理の簡素化

### 現行の問題

現行実装では以下の 4 つの独立した仕組みが絡み合っている：

1. **Bottom Lock** (`bottomLockRef` + `bottomLockTimerRef` + `handleFollowOutput` + `handleAtBottomStateChange`) — Virtuoso の `followOutput` API に合わせた追従制御
2. **Viewport Lock** (`lockTargetRef` + `ResizeObserver` + `getViewportLockTarget` / `getEditingLockTarget`) — コンテンツ高さ変化時のスクロール位置補正
3. **Anchor Tracking** (`anchorRef` + `handleRangeChanged` + `refreshAnchorOffsetWithinItem`) — Virtuoso の `rangeChanged` に依存したアンカー追跡
4. **Dual Ref** (`scrollerRef` + `scrollerElement` + `handleScrollerRef` + `scrollListenerCleanupRef`) — Virtuoso の `scrollerRef` callback に合わせた二重管理

### 簡素化後

| 現行 | 置き換え | 削除量 |
|------|---------|--------|
| Viewport Lock (ResizeObserver + lockTarget + drift 補正) | CSS `overflow-anchor: auto` | ~80 行 |
| Bottom Lock (4 つの ref/callback) | `atBottom` state + `useEffect` | ~50 行 |
| Anchor Tracking (rangeChanged + refreshOffset) | scroll イベントで `scrollTop` ベース計算 | ~20 行 |
| Dual Ref (handleScrollerRef + cleanup) | callback ref + element state（簡素化） | ~30 行 |

**削減見込み: 約 180 行（~600 行 → ~420 行）**

---

## Step 1: CSS `overflow-anchor` によるビューポート安定化

### 背景

CSS `overflow-anchor: auto` はブラウザネイティブのスクロールアンカリング機能。
スクロールコンテナ内の要素の高さが変わったとき、ブラウザが自動的に `scrollTop` を補正して
ビューポート内の可視要素の位置を維持する。

現行の `lockTargetRef` + `ResizeObserver` + drift 補正ロジック（~80 行）が
やっていることと同等の処理を CSS 1 行で実現する。

### 削除するコード

```
getViewportLockTarget()          L100-121  — 22 行
getEditingLockTarget()           L123-137  — 15 行
getLockTarget()                  L139-141  — 3 行
getVirtuosoListContainer()       L143-151  — 9 行
LockTarget 型                    L39-42    — 4 行
lockTargetRef                    L312      — 1 行
shouldLockViewport (部分)         L528      — viewport lock 判定を削除、editing 判定は残す
ResizeObserver effect            L674-700  — 27 行
scroll→lockTarget 更新 effect    L702-720  — 19 行
lockTarget 設定 effect           L663-672  — 10 行
```

### 追加するコード

```css
/* scroll container */
[data-chat-scroller] {
  overflow-anchor: auto;  /* デフォルトだが明示 */
}

/* Footer をアンカー候補から除外 */
[data-chat-scroller] > footer {
  overflow-anchor: none;
}
```

### `overflow-anchor` で対処できるケース

- メッセージ編集中に他メッセージの高さが変わる → ブラウザがアンカーを維持
- ストリーミング中に上の方のメッセージを見ている → ビューポート位置が安定
- コードブロックの折りたたみ/展開 → アンカー補正が自動適用

### `overflow-anchor` の制約と対処

- ブラウザはビューポート内の最初の可視要素をアンカーに選ぶ。編集中の textarea のバブルが
  必ずしもアンカーになるとは限らないが、**編集中のバブルは通常ビューポート内にある**ため
  実用上問題ない
- Footer に `overflow-anchor: none` を付けることで、Footer の高さ変化
  （生成中ボタン、エラー表示）がアンカー選択に干渉しない

---

## Step 2: ストリーミング追従の簡素化

### 現行（~50 行）

```
handleFollowOutput()          — Virtuoso callback、条件分岐が複雑
handleAtBottomStateChange()   — 500ms debounce の unlock ロジック
bottomLockRef                 — follow 強制フラグ
bottomLockTimerRef            — debounce タイマー
lastScrollTopRef              — 手動スクロール検知用
scroll listener の一部         — 上方 10px 移動で lock 解除
```

### 簡素化後

```tsx
// --- atBottom を scroll イベントから計算 ---
const BOTTOM_THRESHOLD = 150;

useEffect(() => {
  const scroller = scrollerElement;
  if (!scroller) return;

  const onScroll = () => {
    const isBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < BOTTOM_THRESHOLD;
    setAtBottom(isBottom);
    atBottomRef.current = isBottom;
  };

  scroller.addEventListener('scroll', onScroll, { passive: true });
  return () => scroller.removeEventListener('scroll', onScroll);
}, [scrollerElement]);

// --- ストリーミング中の auto-follow ---
useEffect(() => {
  if (!isCurrentChatGenerating || !atBottom || !autoScroll) return;
  if (isEditingInScroller) return;

  const scroller = scrollerRef.current;
  if (!scroller) return;

  // コンテンツ追加を検知して末尾にスクロール
  const observer = new MutationObserver(() => {
    scroller.scrollTop = scroller.scrollHeight;
  });

  // 即座に末尾へ
  scroller.scrollTop = scroller.scrollHeight;

  observer.observe(scroller, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}, [isCurrentChatGenerating, atBottom, autoScroll, isEditingInScroller]);
```

### 削除するもの

- `bottomLockRef`, `bottomLockTimerRef`, `lastScrollTopRef`
- `handleFollowOutput`, `handleAtBottomStateChange`
- `scrollListenerCleanupRef` + cleanup effect
- `handleScrollerRef` 内の bottom lock 解除ロジック

### `handleScrollToBottom` の簡素化

```tsx
// 現行: bottomLockRef + Virtuoso scrollTo + 3フレームリトライ
// 簡素化後:
const handleScrollToBottom = useCallback(() => {
  const scroller = scrollerRef.current;
  if (!scroller) return;
  scroller.scrollTo({
    top: scroller.scrollHeight,
    behavior: animateBubbleNavigation ? 'smooth' : 'auto',
  });
}, [animateBubbleNavigation]);
```

リトライが不要な理由: Virtuoso は仮想化のため要素のレンダリングが遅延し、
scrollHeight が確定しないことがあった。全件レンダリングでは即座に確定する。

---

## Step 3: Scroller Ref の簡素化

### 現行

```tsx
// Virtuoso の scrollerRef callback に合わせた複雑な構造
const handleScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
  // cleanup, ref/state 設定, scroll listener 登録, editing 判定... (~35行)
}, [...]);
```

### 簡素化後

```tsx
const scrollerRef = useRef<HTMLDivElement>(null);
const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null);

const scrollerCallbackRef = useCallback((el: HTMLDivElement | null) => {
  scrollerRef.current = el;
  setScrollerElement(el);
}, []);
```

- `scrollerElement` state は維持（focusin/focusout、keyboard viewport の effect が依存）
- scroll listener は `handleScrollerRef` 内ではなく、専用の `useEffect` で登録（Step 2 参照）
- `scrollListenerCleanupRef` は不要（useEffect の cleanup で管理）

---

## Step 4: レンダリングの書き換え

### DOM 構造

```tsx
<div ref={scrollerCallbackRef} className="h-full overflow-y-auto" data-chat-scroller>
  <div data-message-list>
    {items.map((item, index) => (
      <div key={computeItemKey(index)} data-item-index={index}>
        <Message ... />
        {advancedMode && <NewMessageButton ... />}
      </div>
    ))}
  </div>
  <footer style={{ overflowAnchor: 'none' }}>
    <Footer />
  </footer>
</div>
```

- `data-message-list` wrapper: メッセージ群の構造的グルーピング
- `<footer>` に `overflow-anchor: none`: Footer の高さ変化でアンカーが狂わない
- `data-item-index`: バブルナビゲーションで引き続き使用
- `data-chat-scroller`: iOS ステータスバー、サイドバースワイプのセレクタ

### インポートの変更

```diff
-import { ListRange, Virtuoso, VirtuosoHandle } from 'react-virtuoso';
```

### 削除する定数

```diff
-const SCROLL_TO_BOTTOM_TOP = Number.MAX_SAFE_INTEGER;
-const VIRTUOSO_LIST_SELECTOR = '[data-test-id="virtuoso-item-list"]';
```

### リネームする定数

```diff
-const VIRTUOSO_ITEM_SELECTOR = '[data-item-index]';
+const MESSAGE_ITEM_SELECTOR = '[data-item-index]';
```

---

## Step 5: アンカー保存/復元の簡素化

### 現行

- `handleRangeChanged` (Virtuoso の `rangeChanged` callback) でアンカーインデックスを更新
- `refreshAnchorOffsetWithinItem` でオフセットを計算
- 復元は `virtuosoRef.current?.scrollToIndex()`

### 簡素化後

アンカーの保存は scroll イベント内で計算:

```tsx
// scroll イベントハンドラ内（Step 2 と統合）
const onScroll = () => {
  // atBottom 計算
  const isBottom = ...;

  // アンカー更新
  if (!isBottom) {
    const items = scroller.querySelectorAll<HTMLElement>('[data-item-index]');
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (rect.bottom > scrollerRect.top) {
        anchorRef.current.firstVisibleItemIndex = Number(item.dataset.itemIndex);
        anchorRef.current.offsetWithinItem = scrollerRect.top - rect.top;
        break;
      }
    }
  }
  anchorRef.current.wasAtBottom = isBottom;
};
```

復元は `scrollIntoView` + `scrollTop` 補正:

```tsx
useEffect(() => {
  if (pendingChatFocus && pendingChatFocus.chatIndex === currentChatIndex) return;
  const anchor = getChatScrollAnchor(currentChatId);
  if (!anchor || anchor.wasAtBottom) return;

  requestAnimationFrame(() => {
    const scroller = scrollerRef.current;
    const item = scroller?.querySelector(`[data-item-index="${anchor.firstVisibleItemIndex}"]`);
    if (!item || !scroller) return;
    item.scrollIntoView({ block: 'start' });
    scroller.scrollTop += anchor.offsetWithinItem;
  });
}, [currentChatIndex]);
```

### 削除するもの

- `handleRangeChanged`
- `refreshAnchorOffsetWithinItem`

---

## Step 6: `isEditingMessageElement` の修正

### 変更

- `VIRTUOSO_ITEM_SELECTOR` → `MESSAGE_ITEM_SELECTOR` にリネーム
- `VIRTUOSO_LIST_SELECTOR` は削除
- 関数ロジックはそのまま（`data-item-index` は維持するため）
- `isEditingInScroller` state + focusin/focusout effect もそのまま維持
  （auto-follow 抑制と keyboard viewport の判定に使用）

---

## Step 7: `useIosStatusBarScroll.ts` の更新

```diff
-const scroller = document.querySelector('[data-virtuoso-scroller="true"]');
+const scroller = document.querySelector('[data-chat-scroller]');
```

---

## Step 8: `main.css` の更新

```diff
-.sidebar-swiping [data-virtuoso-scroller='true'] {
+.sidebar-swiping [data-chat-scroller] {
   touch-action: none !important;
   pointer-events: none !important;
 }
```

---

## Step 9: テストの更新

### 9a. 既存テストの修正 (`ChatContent.test.ts`)
- `VIRTUOSO_ITEM_SELECTOR` → `MESSAGE_ITEM_SELECTOR` に追従
- Virtuoso 固有のモック削除

### 9b. ストリーミング追従テスト（新規 — 最重要）
- **auto-follow**: ストリーミング中に `atBottom` なら、コンテンツ追加で `scrollTop` が追従
- **手動スクロールアップで解除**: 上方スクロールで auto-follow 停止
- **ボトム復帰で再開**: ボトムに戻ると auto-follow 再開
- **編集中の抑制**: `isEditingInScroller` が true なら auto-follow しない

### 9c. スクロール復元テスト（新規）
- **pendingChatFocus**: 指定メッセージまでスクロール
- **保存済みアンカー復元**: `scrollTop` が正しく復元
- **アンカー不在時のフォールバック**: 末尾にスクロール

### 9d. `overflow-anchor` 動作確認（手動テスト）
- メッセージ編集中に他メッセージの高さが変わってもビューポートが安定
- Footer の高さ変化でスクロールが飛ばない
- ※ `overflow-anchor` はブラウザ実装のため JSDOM ではテスト不可。手動テスト項目として管理

### 9e. `useIosStatusBarScroll` テスト
- セレクタ変更後もステータスバータップが動作

---

## Step 10: パッケージの削除

```bash
yarn remove react-virtuoso
```

---

## 削除コードまとめ

| 対象 | 行数 | 理由 |
|------|------|------|
| `getViewportLockTarget` / `getEditingLockTarget` / `getLockTarget` | ~40 行 | `overflow-anchor` で代替 |
| `getVirtuosoListContainer` | ~9 行 | 不要 |
| `LockTarget` 型 | ~4 行 | 不要 |
| ResizeObserver effect | ~27 行 | `overflow-anchor` で代替 |
| scroll→lockTarget 更新 effect | ~19 行 | `overflow-anchor` で代替 |
| lockTarget 設定 effect | ~10 行 | `overflow-anchor` で代替 |
| `handleFollowOutput` | ~14 行 | useEffect で代替 |
| `handleAtBottomStateChange` | ~17 行 | scroll イベントで代替 |
| `handleScrollerRef` | ~35 行 | callback ref に簡素化 |
| `handleRangeChanged` | ~5 行 | scroll イベントに統合 |
| `refreshAnchorOffsetWithinItem` | ~13 行 | scroll イベントに統合 |
| `bottomLockRef` 関連 refs | ~4 行 | 不要 |
| `scrollListenerCleanupRef` + effect | ~10 行 | useEffect cleanup で管理 |
| **合計** | **~207 行** | |

## 新規追加コードまとめ

| 対象 | 行数 |
|------|------|
| CSS `overflow-anchor` 指定 | ~4 行 |
| scroll イベント effect（atBottom + アンカー） | ~25 行 |
| MutationObserver auto-follow effect | ~15 行 |
| callback ref | ~5 行 |
| `handleScrollToBottom` 簡素化 | ~7 行 |
| DOM 構造（map + footer） | ~15 行 |
| **合計** | **~71 行** |

**差引: 約 136 行の純減**

---

## 影響範囲まとめ

| ファイル | 変更内容 |
|---------|---------|
| `ChatContent.tsx` | Virtuoso → プレーン div、スクロール管理の大幅簡素化 |
| `useIosStatusBarScroll.ts` | セレクタを `[data-chat-scroller]` に変更（1行） |
| `main.css` | セレクタを `[data-chat-scroller]` に変更（1行） |
| `ChatContent.test.ts` | 定数名変更に追従 + テスト追加 |
| `package.json` | `react-virtuoso` を削除 |

---

## リスク

1. **`overflow-anchor` の精度** — ブラウザの実装に依存。Chrome/Safari/Firefox すべてでサポート済み。
   万が一問題が出た場合は、特定要素への `overflow-anchor: none` 付与で制御可能。
   最悪の場合、編集時のみ旧来の ResizeObserver ロジックにフォールバック可能
2. **ストリーミング中の auto-scroll** — MutationObserver で十分かの検証が必要。
   `characterData: true` でテキストノードの変化も検知する。
   パフォーマンスが問題なら `requestAnimationFrame` でスロットル
3. **大規模会話 (200件超) でのパフォーマンス** — `content-visibility: auto` で対処。
   問題が出れば `@tanstack/react-virtual` を後日導入
