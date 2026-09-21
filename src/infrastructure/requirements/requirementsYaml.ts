import { parseDocument, stringify } from 'yaml';
import { AnalysisFailure } from '../../domain/requirements/AnalysisFailure';
import { MAX_REQUIREMENTS_BYTES, type RequirementsArtifact } from '../../domain/requirements/requirements';
import { validateRequirementsArtifact } from '../../domain/requirements/validateRequirements';

export function parseRequirementsYaml(text: string): RequirementsArtifact {
  try {
    if (Buffer.byteLength(text, 'utf8') > MAX_REQUIREMENTS_BYTES) throw new AnalysisFailure('INVALID_ARTIFACT');
    const document = parseDocument(text, { schema: 'core', version: '1.2', uniqueKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length) throw new AnalysisFailure('INVALID_ARTIFACT');
    const data: unknown = document.toJS({ maxAliasCount: 0 });
    return validateRequirementsArtifact(data);
  } catch { throw new AnalysisFailure('INVALID_ARTIFACT'); }
}
export function serializeRequirementsYaml(value: RequirementsArtifact): string {
  const text = stringify(validateRequirementsArtifact(value), { lineWidth: 0 });
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUIREMENTS_BYTES) throw new AnalysisFailure('INVALID_ARTIFACT');
  return text;
}
