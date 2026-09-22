import type { Inventory } from '../../../domain/repository/inventory';
import { PACKAGE_MANAGER_CATALOG, type DetectedTechnology } from '../../../domain/repository/technology';
export function packageManagers(technologies: readonly DetectedTechnology[]): Pick<Inventory['tooling'], 'packageManager' | 'packageManagers'> {
  const findings = technologies.filter((item) => item.kind === 'PACKAGE_MANAGER');
  const names: Inventory['tooling']['packageManagers'][number][] = [];
  const evidence: Inventory['tooling']['packageManager']['evidence'][number][] = [];
  const scopes = new Map<string, Set<string>>();
  for (const finding of findings) {
    const definition = PACKAGE_MANAGER_CATALOG.find((item) => item.id === finding.id);
    if (!definition) continue;
    names.push(definition.name);
    for (const ref of finding.evidence) {
      evidence.push({ relativePath: ref.relativePath, signal: ref.type === 'MANIFEST' && /lock/i.test(ref.value) ? `lockfile ${definition.name}` : ref.value });
      // pip describes a compatible installer, not an exclusive environment manager.
      if (definition.name === 'pip') continue;
      const scope = `${definition.ecosystem}:${ref.relativePath.includes('/') ? ref.relativePath.slice(0, ref.relativePath.lastIndexOf('/')) : '.'}`;
      const values = scopes.get(scope) ?? new Set<string>(); values.add(definition.id); scopes.set(scope, values);
    }
  }
  names.sort(); const conflict = [...scopes.values()].some((values) => values.size > 1);
  return { packageManagers: names, packageManager: { name: names.length === 1 ? names[0] ?? 'UNKNOWN' : 'UNKNOWN', conflict, evidence } };
}
