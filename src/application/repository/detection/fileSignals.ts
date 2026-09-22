import { LANGUAGE_CATALOG, type Language } from '../../../domain/repository/technology';
import type { ManifestType } from '../../../domain/repository/inventory';
const names: Readonly<Record<string, ManifestType>> = {
  'package.json': 'NPM_PACKAGE', 'package-lock.json': 'LOCKFILE', 'pnpm-lock.yaml': 'LOCKFILE', 'yarn.lock': 'LOCKFILE', 'bun.lock': 'LOCKFILE',
  'pnpm-workspace.yaml': 'WORKSPACE_CONFIG', 'turbo.json': 'WORKSPACE_CONFIG', 'nx.json': 'WORKSPACE_CONFIG',
  'pyproject.toml': 'PYTHON_PROJECT', 'requirements.txt': 'PYTHON_REQUIREMENTS', 'poetry.lock': 'LOCKFILE', 'uv.lock': 'LOCKFILE',
  'pom.xml': 'MAVEN', 'build.gradle': 'GRADLE', 'build.gradle.kts': 'GRADLE', 'go.mod': 'GO_MODULE', 'cargo.toml': 'RUST_PACKAGE',
  'dockerfile': 'DOCKER', 'docker-compose.yml': 'DOCKER', 'docker-compose.yaml': 'DOCKER', 'compose.yml': 'DOCKER', 'compose.yaml': 'DOCKER',
  'pipfile': 'PIPFILE', 'setup.py': 'PYTHON_SETUP', 'setup.cfg': 'PYTHON_SETUP',
  'settings.gradle': 'WORKSPACE_CONFIG', 'settings.gradle.kts': 'WORKSPACE_CONFIG', 'gradlew': 'TOOL_CONFIG',
  'global.json': 'TOOL_CONFIG', 'go.sum': 'LOCKFILE', 'go.work': 'WORKSPACE_CONFIG', 'cargo.lock': 'LOCKFILE',
  'gemfile': 'RUBY_GEMFILE', 'gemfile.lock': 'LOCKFILE', 'composer.json': 'PHP_COMPOSER', 'composer.lock': 'LOCKFILE',
  'package.swift': 'SWIFT_PACKAGE', 'pubspec.yaml': 'DART_PACKAGE', 'pubspec.lock': 'LOCKFILE', 'schema.prisma': 'PRISMA_SCHEMA',
  'cmakelists.txt': 'TOOL_CONFIG', 'nest-cli.json': 'TOOL_CONFIG',
};
export function manifestType(path: string): ManifestType | undefined {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (/\.(csproj|fsproj)$/.test(name)) return 'DOTNET_PROJECT';
  if (/\.sln$/.test(name)) return 'DOTNET_SOLUTION';
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) return 'CI_WORKFLOW';
  if (/^tsconfig(?:\.[^.]+)*\.json$/.test(name)) return 'TYPESCRIPT_CONFIG';
  if (/^(vitest|jest|vite|webpack|eslint)\.config\.[cm]?[jt]s$/.test(name) || name === 'pytest.ini') return 'TOOL_CONFIG';
  return names[name];
}
export function inspectMetadata(path: string): boolean {
  return ['NPM_PACKAGE', 'PYTHON_PROJECT', 'PYTHON_REQUIREMENTS', 'MAVEN', 'GRADLE', 'GO_MODULE', 'RUST_PACKAGE', 'PIPFILE', 'PYTHON_SETUP', 'DOTNET_PROJECT', 'RUBY_GEMFILE', 'PHP_COMPOSER', 'SWIFT_PACKAGE', 'DART_PACKAGE'].includes(manifestType(path) ?? '');
}
export function isPackageManifest(path: string): boolean { return inspectMetadata(path) && !['PYTHON_REQUIREMENTS', 'PIPFILE'].includes(manifestType(path) ?? ''); }
export function language(path: string): Language['name'] | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_CATALOG.find((item) => (item.extensions as readonly string[]).includes(ext))?.name;
}
export function isTestFile(path: string): boolean {
  return /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.(?:py|go)$|(?:Test|Tests)\.(?:java|kt|cs)$|_spec\.rb$|(?:^|\/)test_[^/]+\.rb$|Test\.php$|Tests\.swift$|_test\.dart$)/.test(path);
}
export function importantReason(path: string): { score: number; reason: string } | undefined {
  const type = manifestType(path);
  if (type) return { score: path.includes('/') ? 70 : 100, reason: `${path.includes('/') ? 'package/configuration' : 'root'} ${type.toLowerCase().replace(/_/g, ' ')}` };
  if (/(^|\/)(main|index|app|application|server)\.[cm]?[jt]sx?$|(^|\/)(main|app)\.(py|go|rs)$|Application\.java$/i.test(path)) return { score: 80, reason: 'entry-point filename candidate' };
  if (/\.(module|routes?|router)\.[jt]s$|(^|\/)routes?\.[jt]sx?$/.test(path)) return { score: 60, reason: 'module or routing filename candidate' };
  if (/(^|\/)(main\.(?:c|cpp|dart|kt)|program\.cs|appdelegate\.swift|index\.php)$/i.test(path)) return { score: 80, reason: 'entry-point filename candidate' };
  if (/schema\.prisma$|(^|\/)schema\.sql$|(^|\/)(architecture|readme)\.md$/i.test(path)) return { score: 50, reason: 'schema or architecture documentation candidate' };
  return undefined;
}
