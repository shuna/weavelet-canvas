import { useEffect, useState } from 'react';
import useTokenEncoder from '@hooks/useTokenEncoder';
import countTokens from '@utils/messageUtils';
import { bubbleSummarySubmitMessage } from '@utils/bubbleSummary';
import type { BubbleSummary, MessageInterface, ModelOptions } from '@type/chat';

export const summaryTokenLabel = (tokens: number, original: number, isOriginal = false) =>
  `${tokens} tokens${isOriginal ? '' : `, ${original > 0 ? Math.round((1 - tokens / original) * 100) : 0}%`}`;

export default function useSummaryTokenCounts(messages: MessageInterface[], model: ModelOptions, readable?: BubbleSummary, compact?: BubbleSummary) {
  const encoderReady = useTokenEncoder();
  const [counts, setCounts] = useState<{ original: number; summary?: number; compact?: number }>();
  useEffect(() => {
    let cancelled = false;
    setCounts(undefined);
    void Promise.all([
      countTokens(messages, model),
      readable ? countTokens([bubbleSummarySubmitMessage(readable)], model) : undefined,
      compact ? countTokens([bubbleSummarySubmitMessage(compact)], model) : undefined,
    ]).then(([original, summary, compact]) => { if (!cancelled) setCounts({ original: original!, summary, compact }); });
    return () => { cancelled = true; };
  }, [messages, model, readable, compact, encoderReady]);
  return counts;
}
