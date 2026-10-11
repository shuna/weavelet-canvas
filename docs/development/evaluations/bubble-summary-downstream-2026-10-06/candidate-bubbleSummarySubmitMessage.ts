import type { BubbleSummary, MessageInterface } from '@type/chat';
import { normalizeBubbleSummaryText } from '../../../../src/utils/bubbleSummary';

export const candidateSubmitMessage = (summary: BubbleSummary): MessageInterface => ({ role: 'user', content: [{ type: 'text', text: `Retained conversation context for the next response. Answer the latest request using its retained requirements, including language, tone, structure and length. Do not report this context or imitate its memo layout; preserve the retained prose/dialogue form. Adopted or planned actions are not completed actions. Do not invent execution or verification.:\n${normalizeBubbleSummaryText(summary.text)}` }] });
