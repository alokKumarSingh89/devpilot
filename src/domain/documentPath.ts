import { DocumentFailure } from './DocumentFailure';
import { EXCLUDED_DOCUMENT_DIRECTORIES, type DocumentFormat } from './document';

/** Manifest paths use literal slash-separated segments, never URI escapes or drive paths. */
export function validateDocumentPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\:%\u0000-\u001f\u007f]/.test(value)) throw new DocumentFailure('INVALID_PATH');
  const segments = value.split('/');
  if (segments.some((part) => !part || part === '.' || part === '..' || part.trim() !== part)) throw new DocumentFailure('INVALID_PATH');
  return value;
}
export function documentFormat(relativePath: string): DocumentFormat {
  const extension = relativePath.split('.').pop()?.toLowerCase();
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'txt') return 'text';
  throw new DocumentFailure('UNSUPPORTED');
}
export function excludedDocumentPath(relativePath: string): boolean {
  return relativePath.split('/').slice(0, -1).some((part) => EXCLUDED_DOCUMENT_DIRECTORIES.some((excluded) => excluded === part.toLowerCase()));
}
