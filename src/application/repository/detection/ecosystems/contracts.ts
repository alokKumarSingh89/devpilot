import type { ManifestType } from '../../../../domain/repository/inventory';
import { TECHNOLOGY_CATALOG, type DetectedTechnology, type TechnologyKind, type TechnologyEvidence } from '../../../../domain/repository/technology';
export interface DetectorInput { readonly path: string; readonly type: ManifestType; readonly text?: string }
export interface TechnologyDetector { readonly id: string; supports(input: DetectorInput): boolean; detect(input: DetectorInput): readonly DetectedTechnology[] }
export function finding(input: DetectorInput, kind: TechnologyKind, name: string, value: string, type: TechnologyEvidence['type'] = 'DEPENDENCY'): DetectedTechnology {
  const definition = TECHNOLOGY_CATALOG.find((item) => item.kind === kind && item.name === name);
  if (!definition) throw new Error('Unknown internal technology definition');
  return { ...definition, evidence: [{ type, relativePath: input.path, value }] };
}
export function object(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function json(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid manifest object');
  return object(value);
}
export function withoutComments(text: string): string { return text.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:#|\/\/).*$/gm, ''); }
export interface DependencyRule { readonly dependency: string; readonly kind: TechnologyKind; readonly name: string }
export function dependencyFindings(input: DetectorInput, dependencies: ReadonlySet<string>, rules: readonly DependencyRule[]): DetectedTechnology[] {
  return rules.filter((rule) => dependencies.has(rule.dependency)).map((rule) => finding(input, rule.kind, rule.name, rule.dependency));
}
