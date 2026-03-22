import React, { Suspense, memo, useDeferredValue, useEffect, useRef, useState } from 'react';
import { perfStart, perfEnd } from '@utils/perfTrace';
import type { StreamingMarkdownPolicy } from '@type/chat';
import { resolveStreamingMarkdownMode } from '@utils/markdownStreamingPolicy';
import { useStreamEndStatusStore, type StreamEndReason } from '@store/stream-end-status-store';

const MarkdownRenderer = React.lazy(() => import('./MarkdownRenderer'));

const RENDER_DELAY_THRESHOLD_MS = 400;

const skeletonWidths = ['w-full', 'w-5/6', 'w-4/5', 'w-3/4', 'w-full', 'w-5/6', 'w-2/3', 'w-3/4'];

const MarkdownSkeleton = ({ charCount, newlineCount }: { charCount: number; newlineCount: number }) => {
  const estimatedLines = newlineCount > 0 ? newlineCount + 1 : Math.ceil(charCount / 80);
  const lineCount = Math.max(estimatedLines, 2);
  return (
    <div className='py-1' aria-hidden='true'>
      {Array.from({ length: lineCount }, (_, i) => (
        <div
          key={i}
          className={`h-4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-2 ${skeletonWidths[i % skeletonWidths.length]}`}
        />
      ))}
    </div>
  );
};

const streamEndLabels: Record<StreamEndReason, { text: string; className: string }> = {
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

const StreamEndIndicator = memo(function StreamEndIndicator({ nodeId }: { nodeId?: string }) {
  const status = useStreamEndStatusStore((state) =>
    nodeId ? state.statuses[nodeId] : undefined
  );

  if (!status) return null;

  const label = streamEndLabels[status];
  return (
    <div className={`mt-1 text-xs ${label.className} transition-opacity duration-500`}>
      {status === 'completed' ? '✓ ' : status === 'error' ? '✕ ' : status === 'max_tokens' || status === 'recovered_partial' ? '⚠ ' : status === 'interrupted' ? '⏸ ' : '↻ '}
      {label.text}
    </div>
  );
});

const ContentBody = memo(function ContentBody({
  currentTextContent,
  markdownMode,
  streamingMarkdownPolicy,
  inlineLatex,
  isGeneratingMessage,
  nodeId,
}: {
  currentTextContent: string;
  markdownMode: boolean;
  streamingMarkdownPolicy: StreamingMarkdownPolicy;
  inlineLatex: boolean;
  isGeneratingMessage: boolean;
  nodeId?: string;
}) {
  const hasCodeBlock = currentTextContent.includes('```');
  const streamingMode = resolveStreamingMarkdownMode({
    policy: streamingMarkdownPolicy,
    isGeneratingMessage,
    textLength: currentTextContent.length,
    hasCodeBlock,
  });
  const deferredContent = useDeferredValue(currentTextContent);
  const [debouncedContent, setDebouncedContent] = useState(currentTextContent);
  const renderContent = streamingMode === 'debounced' ? debouncedContent : deferredContent;
  const isStale = renderContent !== currentTextContent;
  const shouldShowRenderingBadge = isStale && !isGeneratingMessage;
  const [showRenderingBadge, setShowRenderingBadge] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (streamingMode !== 'debounced') {
      setDebouncedContent(currentTextContent);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setDebouncedContent(currentTextContent);
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentTextContent, streamingMode]);

  useEffect(() => {
    if (shouldShowRenderingBadge) {
      timerRef.current = setTimeout(() => {
        setShowRenderingBadge(true);
      }, RENDER_DELAY_THRESHOLD_MS);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShowRenderingBadge(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [shouldShowRenderingBadge]);

  const wasGenerating = useRef(false);
  useEffect(() => {
    if (!wasGenerating.current && isGeneratingMessage) {
      perfStart('markdown-finalize');
    } else if (wasGenerating.current && !isGeneratingMessage) {
      perfEnd('markdown-finalize');
    }
    wasGenerating.current = isGeneratingMessage;
  }, [isGeneratingMessage]);

  return (
    <div className='markdown prose w-full max-w-full break-words dark:prose-invert dark'>
      {markdownMode ? (
        <>
          {isGeneratingMessage && streamingMode === 'plain' ? (
            <span className='whitespace-pre-wrap'>
              {currentTextContent}
              <span className='inline-block animate-pulse text-gray-500 dark:text-gray-400'>▌</span>
            </span>
          ) : (
            <>
              {showRenderingBadge && (
                <span className='inline-block text-xs text-gray-400 dark:text-gray-500 mb-1 animate-pulse'>
                  描画中...
                </span>
              )}
              <Suspense fallback={<MarkdownSkeleton charCount={currentTextContent.length} newlineCount={(currentTextContent.match(/\n/g) || []).length} />}>
                <MarkdownRenderer
                  content={renderContent}
                  inlineLatex={inlineLatex}
                />
              </Suspense>
              {isGeneratingMessage && (
                <span className='inline-block animate-pulse text-gray-500 dark:text-gray-400'>▌</span>
              )}
            </>
          )}
        </>
      ) : (
        <span className='whitespace-pre-wrap'>
          {currentTextContent}
          {isGeneratingMessage && <span className='animate-pulse'>▌</span>}
        </span>
      )}
      {!isGeneratingMessage && <StreamEndIndicator nodeId={nodeId} />}
    </div>
  );
});

export default ContentBody;
