import { documentFormat, validateDocumentPath } from '../documentPath';
import { AnalysisFailure } from './AnalysisFailure';
import { CONFIDENCES, CONSTRAINT_CATEGORIES, MAX_EVIDENCE_LENGTH, NFR_CATEGORIES, PRIORITIES, type RequirementsArtifact, type RequirementsContent, type SourceReference } from './requirements';

function invalid(): never { throw new AnalysisFailure('INVALID_OUTPUT'); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== keys.length || keys.some((key) => !Object.hasOwn(data, key))) return invalid();
  return data;
}
function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return invalid();
  return value.trim();
}
function list<T>(value: unknown, parse: (item: unknown) => T, min = 0, max = 200): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return invalid();
  return value.map(parse);
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  const result = choices.find((item) => item === value);
  return result ?? invalid();
}
function id(value: unknown, prefix: string): string {
  const result = text(value, 100);
  if (!new RegExp(`^${prefix}-[A-Z0-9]+(?:-[A-Z0-9]+)*$`).test(result)) return invalid();
  return result;
}
const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();
const contentKeys = ['product', 'actors', 'functionalRequirements', 'nonFunctionalRequirements', 'constraints', 'outOfScope', 'openQuestions'] as const;

/** Strict reconstruction; evidence must occur in the actual PRD when validating a new analysis. */
export function validateRequirementsContent(value: unknown, prd?: string): RequirementsContent {
  const root = record(value, contentKeys);
  const source = prd === undefined ? undefined : normalize(prd);
  const refs = (value: unknown): SourceReference[] => list(value, (entry) => {
    const data = record(entry, ['section', 'evidence']);
    const evidence = text(data.evidence, MAX_EVIDENCE_LENGTH);
    if (source !== undefined && !source.includes(normalize(evidence))) return invalid();
    return { section: text(data.section, 200), evidence };
  }, 1, 5);
  const product = record(root.product, ['name', 'summary']);
  const actors = list(root.actors, (entry) => {
    const data = record(entry, ['id', 'name', 'description']);
    return { id: id(data.id, 'ACTOR'), name: text(data.name, 160), description: text(data.description) };
  });
  const actorIds = new Set(actors.map((actor) => actor.id));
  const functionalRequirements = list(root.functionalRequirements, (entry) => {
    const data = record(entry, ['id', 'title', 'description', 'priority', 'actorIds', 'acceptanceCriteria', 'sourceReferences', 'confidence']);
    const referencedActors = list(data.actorIds, (value) => id(value, 'ACTOR'), 0, 50);
    if (new Set(referencedActors).size !== referencedActors.length || referencedActors.some((value) => !actorIds.has(value))) return invalid();
    return {
      id: id(data.id, 'FR'), title: text(data.title, 160), description: text(data.description),
      priority: choice(data.priority, PRIORITIES), actorIds: referencedActors,
      acceptanceCriteria: list(data.acceptanceCriteria, (value) => text(value, 1000), 1, 20),
      sourceReferences: refs(data.sourceReferences), confidence: choice(data.confidence, CONFIDENCES),
    };
  });
  const nonFunctionalRequirements = list(root.nonFunctionalRequirements, (entry) => {
    const data = record(entry, ['id', 'category', 'title', 'description', 'measurableTarget', 'sourceReferences', 'confidence']);
    return {
      id: id(data.id, 'NFR'), category: choice(data.category, NFR_CATEGORIES), title: text(data.title, 160), description: text(data.description),
      measurableTarget: data.measurableTarget === null ? null : text(data.measurableTarget, 1000),
      sourceReferences: refs(data.sourceReferences), confidence: choice(data.confidence, CONFIDENCES),
    };
  });
  const constraints = list(root.constraints, (entry) => {
    const data = record(entry, ['id', 'category', 'description', 'sourceReferences']);
    return { id: id(data.id, 'CONSTRAINT'), category: choice(data.category, CONSTRAINT_CATEGORIES), description: text(data.description), sourceReferences: refs(data.sourceReferences) };
  });
  const outOfScope = list(root.outOfScope, (entry) => {
    const data = record(entry, ['id', 'description', 'sourceReferences']);
    return { id: id(data.id, 'OOS'), description: text(data.description), sourceReferences: refs(data.sourceReferences) };
  });
  const openQuestions = list(root.openQuestions, (entry) => {
    const data = record(entry, ['id', 'question', 'sourceReferences']);
    return { id: id(data.id, 'QUESTION'), question: text(data.question), sourceReferences: refs(data.sourceReferences) };
  });
  const ids = [...actors, ...functionalRequirements, ...nonFunctionalRequirements, ...constraints, ...outOfScope, ...openQuestions].map((item) => item.id);
  if (new Set(ids).size !== ids.length) return invalid();
  return { product: { name: text(product.name, 160), summary: text(product.summary, 3000) }, actors, functionalRequirements, nonFunctionalRequirements, constraints, outOfScope, openQuestions };
}

export function validateRequirementsArtifact(value: unknown): RequirementsArtifact {
  try {
    const root = record(value, ['schemaVersion', 'generated', ...contentKeys]);
    if (root.schemaVersion !== 1) return invalid();
    const generated = record(root.generated, ['generatedAt', 'projectId', 'model', 'source']);
    const model = record(generated.model, ['id', 'vendor', 'family']);
    const source = record(generated.source, ['relativePath', 'contentHash']);
    const generatedAt = text(generated.generatedAt, 24);
    if (new Date(generatedAt).toISOString() !== generatedAt) return invalid();
    const projectId = text(generated.projectId, 36);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(projectId)) return invalid();
    const relativePath = validateDocumentPath(source.relativePath);
    documentFormat(relativePath);
    const contentHash = text(source.contentHash, 64);
    if (!/^[a-f0-9]{64}$/.test(contentHash)) return invalid();
    const content = validateRequirementsContent(Object.fromEntries(contentKeys.map((key) => [key, root[key]])));
    return {
      schemaVersion: 1,
      generated: { generatedAt, projectId, model: { id: text(model.id, 1024), vendor: text(model.vendor, 1024), family: text(model.family, 1024) }, source: { relativePath, contentHash } },
      ...content,
    };
  } catch { throw new AnalysisFailure('INVALID_ARTIFACT'); }
}
