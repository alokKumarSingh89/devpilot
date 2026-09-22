import { AnalysisFailure } from './AnalysisFailure';
import { CONFIDENCES, CONSTRAINT_CATEGORIES, MAX_EVIDENCE_LENGTH, NFR_CATEGORIES, PRIORITIES } from './requirements';

export interface ValidationDiagnostic { readonly path: string; readonly expected: string; readonly received: string; readonly reason: string; readonly quoteLength?: number; readonly normalizedQuoteLength?: number; readonly result?: string; readonly constraintIndex?: number; readonly classificationSignals?: string }
export class AnalysisValidationFailure extends AnalysisFailure {
  constructor(readonly diagnostic: ValidationDiagnostic, code: 'INVALID_OUTPUT' | 'INVALID_ARTIFACT' = 'INVALID_OUTPUT') { super(code); }
}
export type Contract =
  | { readonly type: 'string'; readonly maxLength: number; readonly nullable?: true; readonly enum?: readonly string[] }
  | { readonly type: 'array'; readonly items: Contract; readonly minItems: number; readonly maxItems: number }
  | { readonly type: 'object'; readonly properties: Readonly<Record<string, Contract>> };
const string = (maxLength = 2000): Contract => ({ type: 'string', maxLength });
const enumeration = (values: readonly string[]): Contract => ({ type: 'string', maxLength: 100, enum: values });
const object = (properties: Readonly<Record<string, Contract>>): Contract => ({ type: 'object', properties });
const array = (items: Contract, minItems = 0, maxItems = 200): Contract => ({ type: 'array', items, minItems, maxItems });
const sourceReferences = array(object({ section: string(200), evidence: string(MAX_EVIDENCE_LENGTH) }), 1, 5);
const functional = { title: string(160), description: string(), priority: enumeration(PRIORITIES), actorIds: array(string(100), 0, 50), acceptanceCriteria: array(string(1000), 1, 20), sourceReferences, confidence: enumeration(CONFIDENCES) };
const nonFunctional = { category: enumeration(NFR_CATEGORIES), title: string(160), description: string(), measurableTarget: { type: 'string', maxLength: 1000, nullable: true } as const, sourceReferences, confidence: enumeration(CONFIDENCES) };
/** Every declared property is required. Null is allowed only when nullable is true. No additional properties. */
export function requirementsContract(canonical = false): Contract {
  const references = canonical ? sourceReferences : array(object({ section: string(200), quote: string(MAX_EVIDENCE_LENGTH) }), 1, 5);
  const identity = canonical ? { id: string(100) } : {};
  return object({
    product: object({ name: string(160), summary: string(3000) }),
    actors: array(object({ ...(canonical ? { id: string(100) } : { key: string(100) }), name: string(160), description: string() })),
    functionalRequirements: array(object({ ...identity, ...functional, sourceReferences: references })),
    nonFunctionalRequirements: array(object({ ...identity, ...nonFunctional, sourceReferences: references })),
    constraints: array(object({ ...identity, category: enumeration(CONSTRAINT_CATEGORIES), description: string(), sourceReferences: references })),
    outOfScope: array(object({ ...identity, description: string(), sourceReferences: references })),
    openQuestions: array(object({ ...identity, question: string(), sourceReferences: references })),
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
    if (!Array.isArray(value) || value.length < contract.minItems || value.length > contract.maxItems) return fail(`array(${contract.minItems}..${contract.maxItems})`, 'Wrong collection type or length');
    return value.map((entry, index) => validateContract(entry, contract.items, `${path}[${index}]`, normalize));
  }
  if (value === null && contract.nullable) return null;
  if (typeof value !== 'string') return fail(contract.nullable ? 'string | null' : 'string', 'Wrong value type');
  const text = normalize ? value.trim() : value;
  if (!text.trim() || text.length > contract.maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return fail(`nonempty string <=${contract.maxLength} characters`, 'Empty, oversized or control-containing string');
  if (contract.enum) {
    const candidate = normalize ? text.toUpperCase() : text;
    if (!contract.enum.includes(candidate)) return fail(contract.enum.join(' | '), 'Unknown enum value');
    return candidate;
  }
  return text;
}
