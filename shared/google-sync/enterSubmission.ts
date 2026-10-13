import { enterSubmission } from '../../src/utils/enterSubmission';

export function enterSubmissionOperation(json: string): string {
  return JSON.stringify({ action: enterSubmission(JSON.parse(json)) });
}
