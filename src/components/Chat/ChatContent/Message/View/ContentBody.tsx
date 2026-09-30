import React, { Suspense, memo, useDeferredValue, useEffect, useRef, useState } from 'react';
import { perfStart, perfEnd } from '@utils/perfTrace';
import type { StreamingMarkdownPolicy } from '@type/chat';
import { resolveStreamingMarkdownMode } from '@utils/markdownStreamingPolicy';
import { useStreamEndStatusStore, type StreamEndReason } from '@store/stream-end-status-store';

const MarkdownRenderer = React.lazy(() => import('./MarkdownRenderer'));

const skeletonWidths = ['w-full', 'w-5/6', 'w-4/5', 'w-3/4', 'w-full', 'w-5/6', 'w-2/3', 'w-3/4'];

const MarkdownSkeleton = ({ charCount, newlineCount }: { charCount: number; newlineCount: number }) => {
  const estimatedLines = newlineCount > 0 ? newlineCount + 1 : Math.ceil(charCount / 80);
  const lineCount = Math.max(estimatedLines, 2);
  return (
    <div className='py-1' aria-hidden='true'>
      {Array.from({ length: lineCount }, (_, i) => (
        <div
          key={i}
          className={`h-4 rounded bg-gray-200 dark:bg-gray-700 mb-2 ${skeletonWidths[i % skeletonWidths.length]}`}
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
  const renderContent = !isGeneratingMessage ? currentTextContent
    : streamingMode === 'debounced' ? debouncedContent : deferredContent;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latestContent = useRef(currentTextContent);
  latestContent.current = currentTextContent;

  useEffect(() => {
    setDebouncedContent(latestContent.current);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
    };
  }, [streamingMode]);

  useEffect(() => {
    if (streamingMode !== 'debounced' || debouncedContent === currentTextContent) return;
    // Keep the deadline when more text arrives, so continuous streams keep moving.
    if (!debounceRef.current) {
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        setDebouncedContent(latestContent.current);
      }, 250);
    }
  }, [currentTextContent, streamingMode, debouncedContent]);

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
              <span className='inline-block text-gray-500 dark:text-gray-400'>▌</span>
            </span>
          ) : (
            <>
              <Suspense fallback={<MarkdownSkeleton charCount={currentTextContent.length} newlineCount={(currentTextContent.match(/\n/g) || []).length} />}>
                <MarkdownRenderer
                  content={renderContent}
                  inlineLatex={inlineLatex}
                />
              </Suspense>
              {isGeneratingMessage && (
                <span className='inline-block text-gray-500 dark:text-gray-400'>▌</span>
              )}
            </>
          )}
        </>
      ) : (
        <span className='whitespace-pre-wrap'>
          {currentTextContent}
          {isGeneratingMessage && <span>▌</span>}
        </span>
      )}
      {!isGeneratingMessage && <StreamEndIndicator nodeId={nodeId} />}
    </div>
  );
});

export default ContentBody;
