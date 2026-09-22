import { TOP_LEVEL_LIMITS, ITEM_LIMITS, TEXT_LIMITS, LEGACY_ARTIFACT_LIMITS } from './analysisLimits';
import { AnalysisFailure } from './AnalysisFailure';
import { CONFIDENCES, CONSTRAINT_CATEGORIES, NFR_CATEGORIES, PRIORITIES } from './requirements';

export interface ValidationDiagnostic { readonly path: string; readonly expected: string; readonly received: string; readonly reason: string; readonly quoteLength?: number; readonly normalizedQuoteLength?: number; readonly result?: string; readonly constraintIndex?: number; readonly classificationSignals?: string; readonly minimum?: number; readonly maximum?: number; readonly actualLength?: number }
export class AnalysisValidationFailure extends AnalysisFailure {
  constructor(readonly diagnostic: ValidationDiagnostic, code: 'INVALID_OUTPUT' | 'INVALID_ARTIFACT' = 'INVALID_OUTPUT') { super(code); }
}
export type Contract =
  | { readonly type: 'string'; readonly maxLength: number; readonly nullable?: true; readonly enum?: readonly string[] }
  | { readonly type: 'array'; readonly items: Contract; readonly minItems: number; readonly maxItems: number }
  | { readonly type: 'object'; readonly properties: Readonly<Record<string, Contract>> };
const string = (maxLength: number): Contract => ({ type: 'string', maxLength });
const enumeration = (values: readonly string[]): Contract => ({ type: 'string', maxLength: Math.max(...values.map((value) => value.length)), enum: values });
const object = (properties: Readonly<Record<string, Contract>>): Contract => ({ type: 'object', properties });
const array = (items: Contract, limits: { readonly min: number; readonly max: number }): Contract => ({ type: 'array', items, minItems: limits.min, maxItems: limits.max });
/** Every declared property is required. Null is allowed only when nullable is true. No additional properties. */
export function requirementsContract(canonical = false, legacyArtifact = false): Contract {
  const bounds = canonical && legacyArtifact ? LEGACY_ARTIFACT_LIMITS : ITEM_LIMITS;
  const references = array(object({ section: string(TEXT_LIMITS.section), [canonical ? 'evidence' : 'quote']: string(TEXT_LIMITS.quote) }), bounds.sourceReferences);
  const identity = canonical ? { id: string(TEXT_LIMITS.canonicalId) } : {};
  return object({
    product: object({ name: string(TEXT_LIMITS.name), summary: string(TEXT_LIMITS.summary) }),
    actors: array(object({ ...(canonical ? { id: string(TEXT_LIMITS.canonicalId) } : { key: string(TEXT_LIMITS.actorKey) }), name: string(TEXT_LIMITS.name), description: string(TEXT_LIMITS.description) }), TOP_LEVEL_LIMITS.actors),
    functionalRequirements: array(object({ ...identity, title: string(TEXT_LIMITS.title), description: string(TEXT_LIMITS.description), priority: enumeration(PRIORITIES),
      actorIds: array(string(canonical ? TEXT_LIMITS.canonicalId : TEXT_LIMITS.actorKey), ITEM_LIMITS.actorIds),
      acceptanceCriteria: array(string(TEXT_LIMITS.acceptanceCriterion), bounds.acceptanceCriteria), sourceReferences: references, confidence: enumeration(CONFIDENCES) }), TOP_LEVEL_LIMITS.functionalRequirements),
    nonFunctionalRequirements: array(object({ ...identity, category: enumeration(NFR_CATEGORIES), title: string(TEXT_LIMITS.title), description: string(TEXT_LIMITS.description),
      measurableTarget: { type: 'string', maxLength: TEXT_LIMITS.measurableTarget, nullable: true }, sourceReferences: references, confidence: enumeration(CONFIDENCES) }), TOP_LEVEL_LIMITS.nonFunctionalRequirements),
    constraints: array(object({ ...identity, category: enumeration(CONSTRAINT_CATEGORIES), description: string(TEXT_LIMITS.description), sourceReferences: references }), TOP_LEVEL_LIMITS.constraints),
    outOfScope: array(object({ ...identity, description: string(TEXT_LIMITS.description), sourceReferences: references }), TOP_LEVEL_LIMITS.outOfScope),
    openQuestions: array(object({ ...identity, question: string(TEXT_LIMITS.question), sourceReferences: references }), TOP_LEVEL_LIMITS.openQuestions),
  });
}
export const RAW_MODEL_REQUIREMENTS_CONTRACT = requirementsContract();
export function diagnosticFailure(path: string, expected: string, value: unknown, reason: string): never {
  // Do not echo arbitrary model strings, object keys, evidence or parser exception text into logs.
  const received = value === null ? 'null' : Array.isArray(value) ? `array(length=${value.length})`
    : typeof value === 'string' ? `string(length=${value.length})${([...PRIORITIES, ...CONFIDENCES, ...NFR_CATEGORIES, ...CONSTRAINT_CATEGORIES] as readonly string[]).includes(value.trim().toUpperCase()) ? ` ${value.trim().toUpperCase()}` : ''}` : typeof value;
  throw new AnalysisValidationFailure({ path, expected, received, reason });
}
export function validateContract(value: unknown, contract: Contract, path = '$', normalize = false): unknown {
  const fail = (expected: string, reason: string): never => diagnosticFailure(path, expected, value, reason);
  if (contract.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('object', 'Wrong value type');
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(contract.properties)) {
      const childPath = path === '$' ? key : `${path}.${key}`;
      if (!Object.hasOwn(record, key)) diagnosticFailure(childPath, child.type === 'string' && child.nullable ? 'string | null' : child.type, undefined, 'Required field is missing');
      result[key] = validateContract(record[key], child, childPath, normalize);
    }
    if (Object.keys(record).some((key) => !Object.hasOwn(contract.properties, key))) return fail('only declared fields', 'Unexpected field; names withheld');
    return result;
  }
  if (contract.type === 'array') {
    if (!Array.isArray(value)) return fail(`array(${contract.minItems}..${contract.maxItems})`, 'Expected an array');
    if (value.length < contract.minItems || value.length > contract.maxItems) {
      const label = path.endsWith('.sourceReferences') ? 'source references' : path.endsWith('.acceptanceCriteria') ? 'acceptance criteria' : 'collection entries';
      throw new AnalysisValidationFailure({ path, expected: `array(${contract.minItems}..${contract.maxItems})`, received: `array(length=${value.length})`,
        minimum: contract.minItems, maximum: contract.maxItems, actualLength: value.length,
        reason: `${value.length > contract.maxItems ? 'Too many' : 'Too few'} ${label}` });
    }
    return value.map((entry, index) => validateContract(entry, contract.items, `${path}[${index}]`, normalize));
  }
  if (value === null && contract.nullable) return null;
  if (typeof value !== 'string') return fail(contract.nullable ? 'string | null' : 'string', 'Wrong value type');
  const text = normalize ? value.trim() : value;
  if (!text.trim() || (!contract.enum && text.length > contract.maxLength) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return fail(`nonempty string <=${contract.maxLength} characters`, 'Empty, oversized or control-containing string');
  if (contract.enum) {
    const candidate = normalize ? text.toUpperCase() : text;
    if (!contract.enum.includes(candidate)) return fail(contract.enum.join(' | '), 'Unknown enum value');
    return candidate;
  }
  return text;
}
