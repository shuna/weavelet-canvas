import React, { memo, useState } from 'react';
import useStore from '@store/store';
import { useStreamEndStatusStore, type StreamEndReason } from '@store/stream-end-status-store';
import { recoverPending } from '@hooks/useStreamRecovery';
import { PENDING_RETENTION_MS } from '@utils/streamDb';

const streamEndLabels: Record<StreamEndReason, { text: string; className: string }> = {
  streaming: { text: '応答が中断されました', className: 'text-amber-600 dark:text-amber-400' },
  completed: {
    text: '完了',
    className: 'text-green-500 dark:text-green-400',
  },
  max_tokens: {
    text: '最大トークン数に到達（応答が途切れている可能性があります）',
    className: 'text-amber-500 dark:text-amber-400',
  },
  interrupted: {
    text: '中断されました',
    className: 'text-gray-500 dark:text-gray-400',
  },
  error: {
    text: '送信エラー',
    className: 'text-red-500 dark:text-red-400',
  },
  recovered: {
    text: 'プロキシから復元済み',
    className: 'text-blue-500 dark:text-blue-400',
  },
  recovered_partial: {
    text: 'プロキシから部分復元（応答が不完全です）',
    className: 'text-amber-500 dark:text-amber-400',
  },
};

export default memo(function StreamStatusIndicator({ chatId, nodeId }: { chatId: string; nodeId?: string }) {
  const saved = useStore(state => nodeId ? state.chats?.find(chat => chat.id === chatId)?.branchTree?.nodes[nodeId]?.streamState : undefined);
  const transient = useStreamEndStatusStore(state => nodeId ? state.statuses[nodeId] : undefined);
  const proxyEnabled = useStore(state => state.proxyEnabled && !!state.proxyEndpoint?.trim());
  const [recovering, setRecovering] = useState(false);
  const status = saved?.reason ?? transient;
  if (!status || !nodeId) return null;
  const incomplete = ['streaming', 'interrupted', 'error', 'recovered_partial'].includes(status);
  const expired = saved && Date.now() - saved.createdAt > PENDING_RETENTION_MS;
  const canRecover = incomplete && saved?.proxy && saved.requestId && proxyEnabled && !expired;
  const label = streamEndLabels[status];
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${label.className}`} role='status'>
      <span>{recovering ? 'プロキシから復旧中…' : label.text}</span>
      {canRecover && (
        <button
          type='button'
          className='rounded border border-current px-2 py-1 hover:bg-blue-500/10 disabled:opacity-50'
          disabled={recovering}
          onClick={async event => {
            event.stopPropagation();
            setRecovering(true);
            try { await recoverPending({ manual: true, chatId, nodeId, requestId: saved.requestId }); }
            finally { setRecovering(false); }
          }}
        >
          プロキシから復旧
        </button>
      )}
      {incomplete && expired && <span>復旧データの保持期間が終了しました</span>}
    </div>
  );
});
