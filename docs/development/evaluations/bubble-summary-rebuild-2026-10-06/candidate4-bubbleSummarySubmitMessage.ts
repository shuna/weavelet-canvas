import type { BubbleSummary, MessageInterface } from '@type/chat';
import { normalizeBubbleSummaryText } from '../../../../src/utils/bubbleSummary';

export const candidateSubmitMessage = (summary: BubbleSummary): MessageInterface => ({ role: 'user', content: [{ type: 'text', text: `Retained conversation context. Answer the latest request using the requirements and state below. Follow the retained language, tone, structure and length requirements and examples, not formatting added for this summary. Do not infer unstated subjects or causes as established context. Adoption and plans do not imply execution; preserve uncertainty about what has been done.\n${normalizeBubbleSummaryText(summary.text)}` }] });
