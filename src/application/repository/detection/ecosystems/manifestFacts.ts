import { finding, type TechnologyDetector } from './contracts';
const managers: Readonly<Record<string, string>> = {
  'package-lock.json': 'npm', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lock': 'bun',
  'requirements.txt': 'pip', 'setup.py': 'pip', 'setup.cfg': 'pip', 'poetry.lock': 'poetry', 'uv.lock': 'uv', pipfile: 'Pipenv',
  'pom.xml': 'Maven', 'build.gradle': 'Gradle', 'build.gradle.kts': 'Gradle', 'settings.gradle': 'Gradle', 'settings.gradle.kts': 'Gradle', gradlew: 'Gradle',
  'go.mod': 'Go modules', 'go.sum': 'Go modules', 'go.work': 'Go modules', 'cargo.toml': 'Cargo', 'cargo.lock': 'Cargo',
  gemfile: 'Bundler', 'gemfile.lock': 'Bundler', 'composer.json': 'Composer', 'composer.lock': 'Composer',
  'package.swift': 'Swift Package Manager', 'pubspec.yaml': 'pub', 'pubspec.lock': 'pub',
};
export const manifestFactsDetector: TechnologyDetector = {
  id: 'manifest-facts', supports: () => true, detect(input) {
    const name = input.path.split('/').pop()?.toLowerCase() ?? '';
    const manager = managers[name] ?? (input.type === 'DOTNET_PROJECT' ? 'NuGet' : undefined);
    const result = manager ? [finding(input, 'PACKAGE_MANAGER', manager, name, 'MANIFEST')] : [];
    const build = ({ Maven: 'Maven', Gradle: 'Gradle', 'Go modules': 'Go', Cargo: 'Cargo', NuGet: 'MSBuild', 'Swift Package Manager': 'SwiftPM', pub: 'Dart' } as Readonly<Record<string, string>>)[manager ?? ''];
    if (name === 'cmakelists.txt') result.push(finding(input, 'BUILD_TOOL', 'CMake', name, 'MANIFEST'));
    if (build) result.push(finding(input, 'BUILD_TOOL', build, name, 'MANIFEST'));
    if (input.type === 'DOCKER') result.push(finding(input, 'INFRASTRUCTURE', 'Docker', name, 'MANIFEST'));
    if (input.type === 'CI_WORKFLOW') result.push(finding(input, 'INFRASTRUCTURE', 'GitHub Actions', 'workflow file', 'MANIFEST'));
    if (input.type === 'PRISMA_SCHEMA') result.push(finding(input, 'ORM', 'Prisma', 'schema.prisma', 'MANIFEST'));
    const runtime = ({ MAVEN: 'JVM', GRADLE: 'JVM', DOTNET_PROJECT: '.NET', RUBY_GEMFILE: 'Ruby', PHP_COMPOSER: 'PHP' } as Readonly<Record<string, string>>)[input.type];
    if (runtime) result.push(finding(input, 'RUNTIME', runtime, name, 'MANIFEST'));
    return result;
  },
};
