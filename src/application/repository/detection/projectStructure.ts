import type { Evidence, Inventory } from '../../../domain/repository/inventory';
import { manifestType } from './fileSignals';
export function projectStructure(manifests: Inventory['manifests'], packages: Inventory['packages'], signals: ReadonlyMap<string, { readonly workspace: boolean }>): Omit<Inventory['repository'], 'workspaceName'> {
  const evidence: Evidence[] = [];
  for (const file of manifests) {
    if (['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'go.work'].includes(file.relativePath)) evidence.push({ relativePath: file.relativePath, signal: 'root workspace configuration' });
    if (signals.get(file.relativePath)?.workspace) evidence.push({ relativePath: file.relativePath, signal: 'workspace declaration' });
  }
  const structured = packages.filter((item) => /^(apps|packages|services)\/[^/]+$/.test(item.relativePath));
  if (new Set(structured.map((item) => item.relativePath)).size >= 2) for (const item of structured) evidence.push({ relativePath: item.manifestPath, signal: 'package under conventional apps/packages/services structure' });
  // Several Python manifests can describe one package. Distinct .NET project files can share a directory.
  const projectCount = new Set(packages.map((item) => manifestType(item.manifestPath) === 'DOTNET_PROJECT' ? item.manifestPath : item.relativePath)).size;
  const type = evidence.length ? 'MONOREPO' : projectCount === 1 ? 'SINGLE_PACKAGE' : projectCount > 1 ? 'MULTI_PROJECT' : 'UNKNOWN';
  if (type === 'MULTI_PROJECT') for (const item of packages) evidence.push({ relativePath: item.manifestPath, signal: 'independent project manifest without workspace coordination evidence' });
  return { type, evidence };
}
