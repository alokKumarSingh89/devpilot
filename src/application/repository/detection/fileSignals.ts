import type { ManifestType } from '../../../domain/repository/inventory';
const names: Readonly<Record<string, ManifestType>> = {
  'package.json': 'NPM_PACKAGE', 'package-lock.json': 'LOCKFILE', 'pnpm-lock.yaml': 'LOCKFILE', 'yarn.lock': 'LOCKFILE', 'bun.lock': 'LOCKFILE',
  'pnpm-workspace.yaml': 'WORKSPACE_CONFIG', 'turbo.json': 'WORKSPACE_CONFIG', 'nx.json': 'WORKSPACE_CONFIG',
  'pyproject.toml': 'PYTHON_PROJECT', 'requirements.txt': 'PYTHON_REQUIREMENTS', 'poetry.lock': 'LOCKFILE', 'uv.lock': 'LOCKFILE',
  'pom.xml': 'MAVEN', 'build.gradle': 'GRADLE', 'build.gradle.kts': 'GRADLE', 'go.mod': 'GO_MODULE', 'cargo.toml': 'RUST_PACKAGE',
  'dockerfile': 'DOCKER', 'docker-compose.yml': 'DOCKER', 'docker-compose.yaml': 'DOCKER', 'compose.yml': 'DOCKER', 'compose.yaml': 'DOCKER',
  'nest-cli.json': 'TOOL_CONFIG',
};
export function manifestType(path: string): ManifestType | undefined {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) return 'CI_WORKFLOW';
  if (/^tsconfig(?:\.[^.]+)*\.json$/.test(name)) return 'TYPESCRIPT_CONFIG';
  if (/^(vitest|jest|vite|webpack|eslint)\.config\.[cm]?[jt]s$/.test(name) || name === 'pytest.ini') return 'TOOL_CONFIG';
  return names[name];
}
export function inspectMetadata(path: string): boolean {
  return ['NPM_PACKAGE', 'PYTHON_PROJECT', 'PYTHON_REQUIREMENTS', 'MAVEN', 'GRADLE', 'GO_MODULE', 'RUST_PACKAGE'].includes(manifestType(path) ?? '');
}
export function isPackageManifest(path: string): boolean { return inspectMetadata(path) && manifestType(path) !== 'PYTHON_REQUIREMENTS'; }
export function language(path: string): 'TypeScript' | 'JavaScript' | 'Python' | 'Java' | 'Go' | 'Rust' | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) return 'TypeScript';
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'JavaScript';
  return ({ py: 'Python', java: 'Java', go: 'Go', rs: 'Rust' } as const)[ext as 'py' | 'java' | 'go' | 'rs'];
}
export function isTestFile(path: string): boolean {
  return /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.(?:py|go)$|(?:Test|Tests)\.java$)/.test(path);
}
export function importantReason(path: string): { score: number; reason: string } | undefined {
  const type = manifestType(path);
  if (type) return { score: path.includes('/') ? 70 : 100, reason: `${path.includes('/') ? 'package/configuration' : 'root'} ${type.toLowerCase().replace(/_/g, ' ')}` };
  if (/(^|\/)(main|index|app|application|server)\.[cm]?[jt]sx?$|(^|\/)(main|app)\.(py|go|rs)$|Application\.java$/i.test(path)) return { score: 80, reason: 'entry-point filename candidate' };
  if (/\.(module|routes?|router)\.[jt]s$|(^|\/)routes?\.[jt]sx?$/.test(path)) return { score: 60, reason: 'module or routing filename candidate' };
  if (/schema\.prisma$|(^|\/)schema\.sql$|(^|\/)(architecture|readme)\.md$/i.test(path)) return { score: 50, reason: 'schema or architecture documentation candidate' };
  return undefined;
}
