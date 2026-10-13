import type {ContentInterface} from '../types/chat';
import type {EvaluationSettings} from '../types/evaluation';

export interface AutoEvaluationInput {
  phase: 'pre-send' | 'post-receive';
  userContent: ContentInterface[];
  assistantContent?: ContentInterface[];
  settings: EvaluationSettings;
}

export function autoEvaluationPlan({phase, userContent, assistantContent, settings}: AutoEvaluationInput) {
  const extractText = (content: ContentInterface[]) => content
    .filter((part): part is {type:'text'; text:string} => part.type === 'text')
    .map(part => part.text)
    .join('\n');
  const userText = extractText(userContent);
  const assistantText = assistantContent === undefined ? undefined : extractText(assistantContent);
  return {
    userText,
    assistantText,
    safetyText: phase === 'pre-send' ? userText : (assistantText ?? ''),
    shouldSafety: !!userText && (phase === 'pre-send' ? settings.safetyPreSend : settings.safetyPostReceive) === 'auto',
    shouldQuality: !!userText && (phase === 'pre-send' ? settings.qualityPreSend : settings.qualityPostReceive) === 'auto',
  };
}
