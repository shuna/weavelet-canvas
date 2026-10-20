/** Recognize Drive's invalid-ID response without relying on the error message. */
export function isInvalidSyncFileId(status: number, body: unknown): boolean {
  if (status !== 400 || !body || typeof body !== 'object') return false;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const errors = (error as { errors?: unknown }).errors;
  return Array.isArray(errors) && errors.some(item => item && typeof item === 'object' &&
    (item.location === 'fileId' || item.location === 'parameter fileId'));
}
