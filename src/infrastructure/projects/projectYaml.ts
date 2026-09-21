import { parseDocument, stringify } from 'yaml';
import { ProjectFailure } from '../../domain/ProjectFailure';
import type { ProjectManifest } from '../../domain/project';
import { validateProjectManifest } from '../../domain/validateProjectManifest';

export const MAX_MANIFEST_BYTES = 64 * 1024;

export function parseProjectYaml(text: string): ProjectManifest {
  try {
    if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) throw new ProjectFailure('INVALID_MANIFEST');
    const document = parseDocument(text, { schema: 'core', version: '1.2', uniqueKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length) throw new ProjectFailure('INVALID_MANIFEST');
    const data: unknown = document.toJS({ maxAliasCount: 0 });
    return validateProjectManifest(data);
  } catch (error) {
    if (error instanceof ProjectFailure) throw error;
    throw new ProjectFailure('INVALID_MANIFEST');
  }
}

export function serializeProjectYaml(manifest: ProjectManifest): string {
  try {
    const text = stringify(validateProjectManifest(manifest), { lineWidth: 0 });
    if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) throw new Error('Manifest exceeds size limit');
    return text;
  } catch { throw new ProjectFailure('SERIALIZATION_FAILED'); }
}
