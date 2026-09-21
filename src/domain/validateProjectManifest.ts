import { documentFormat, validateDocumentPath } from './documentPath';
import { HARD_MAX_DOCUMENT_BYTES, type PrdInput } from './document';
import { ProjectFailure } from './ProjectFailure';
import { PROJECT_SCHEMA_VERSION, PROJECT_SOURCES, type ProjectManifest, type ProjectSource } from './project';

function invalid(): never { throw new ProjectFailure('INVALID_MANIFEST'); }
function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const result: Record<string, unknown> = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key) && !optional.includes(key)) || keys.some((key) => !Object.hasOwn(result, key))) return invalid();
  return result;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\u0000-\u001f]/.test(value)) return invalid();
  return value;
}
function timestamp(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result)) return invalid();
  const normalized = result.includes('.') ? result : result.replace('Z', '.000Z');
  const date = new Date(result);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) return invalid();
  return result;
}
export function isProjectSource(value: unknown): value is ProjectSource {
  return typeof value === 'string' && PROJECT_SOURCES.some((source) => source === value);
}

/** Validates unknown input and reconstructs only the portable V1 fields. */
export function validateProjectManifest(value: unknown): ProjectManifest {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) return invalid();
  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    if (typeof value.schemaVersion === 'number') throw new ProjectFailure('UNSUPPORTED_SCHEMA');
    return invalid();
  }
  const root = record(value, ['schemaVersion', 'project', 'workspace', 'ai'], ['inputs']);
  const project = record(root.project, ['id', 'name', 'status', 'source', 'createdAt', 'updatedAt']);
  const workspace = record(root.workspace, ['relativeRoot']);
  const ai = record(root.ai, ['reasoningModel']);
  const model = record(ai.reasoningModel, ['id', 'vendor', 'family']);
  const id = text(project.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return invalid();
  if (project.status !== 'INITIALIZING' && project.status !== 'READY') return invalid();
  if (!isProjectSource(project.source) || workspace.relativeRoot !== '.') return invalid();
  const createdAt = timestamp(project.createdAt);
  const updatedAt = timestamp(project.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) return invalid();
  let inputs: { prd?: PrdInput } | undefined;
  if (Object.hasOwn(root, 'inputs')) {
    const rawInputs = record(root.inputs, [], ['prd']);
    inputs = {};
    if (Object.hasOwn(rawInputs, 'prd')) {
      const prd = record(rawInputs.prd, ['relativePath', 'format', 'sizeBytes', 'importedAt', 'contentHash']);
      let relativePath: string;
      try {
        relativePath = validateDocumentPath(prd.relativePath);
        if (documentFormat(relativePath) !== prd.format) return invalid();
      } catch { return invalid(); }
      if (prd.format !== 'markdown' && prd.format !== 'text') return invalid();
      if (typeof prd.sizeBytes !== 'number' || !Number.isSafeInteger(prd.sizeBytes) || prd.sizeBytes <= 0 || prd.sizeBytes > HARD_MAX_DOCUMENT_BYTES) return invalid();
      if (typeof prd.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(prd.contentHash)) return invalid();
      inputs.prd = { relativePath, format: prd.format, sizeBytes: prd.sizeBytes, importedAt: timestamp(prd.importedAt), contentHash: prd.contentHash };
    }
  }
  return {
    ...(inputs ? { inputs } : {}),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    project: { id, name: text(project.name), status: project.status, source: project.source, createdAt, updatedAt },
    workspace: { relativeRoot: '.' },
    ai: { reasoningModel: { id: text(model.id), vendor: text(model.vendor), family: text(model.family) } },
  };
}
