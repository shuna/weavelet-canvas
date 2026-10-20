import React, { memo, useState } from 'react';
import useStore from '@store/store';
import { useStreamEndStatusStore } from '@store/stream-end-status-store';
import { recoverPending } from '@hooks/useStreamRecovery';
import { describeStreamStatus } from '@utils/streamStatus';

const streamEndColors: Record<string, string> = {
  streaming: 'text-amber-600 dark:text-amber-400',
  completed: 'text-green-500 dark:text-green-400',
  max_tokens: 'text-amber-500 dark:text-amber-400',
  interrupted: 'text-gray-500 dark:text-gray-400',
  error: 'text-red-500 dark:text-red-400',
  recovered: 'text-blue-500 dark:text-blue-400',
  recovered_partial: 'text-amber-500 dark:text-amber-400',
};

export default memo(function StreamStatusIndicator({ chatId, nodeId }: { chatId: string; nodeId?: string }) {
  const saved = useStore(state => nodeId ? state.chats?.find(chat => chat.id === chatId)?.branchTree?.nodes[nodeId]?.streamState : undefined);
  const transient = useStreamEndStatusStore(state => nodeId ? state.statuses[nodeId] : undefined);
  const proxyEnabled = useStore(state => state.proxyEnabled && !!state.proxyEndpoint?.trim());
  const [recovering, setRecovering] = useState(false);
  const status = describeStreamStatus(saved, transient, proxyEnabled, Date.now());
  if (!status || !nodeId) return null;
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${streamEndColors[status.reason]}`} role='status'>
      <span>{recovering ? 'プロキシから復旧中…' : status.text}</span>
      {status.canRecover && (
        <button
          type='button'
          className='rounded border border-current px-2 py-1 hover:bg-blue-500/10 disabled:opacity-50'
          disabled={recovering}
          onClick={async event => {
            event.stopPropagation();
            setRecovering(true);
            try { await recoverPending({ manual: true, chatId, nodeId, requestId: status.requestId! }); }
            finally { setRecovering(false); }
          }}
        >
          プロキシから復旧
        </button>
      )}
      {status.incomplete && status.expired && <span>復旧データの保持期間が終了しました</span>}
    </div>
  );
});
