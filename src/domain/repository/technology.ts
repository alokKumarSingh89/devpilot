/** Detected facts, never selected or recommended project technologies. Internal catalogs are extensible. */
export const LANGUAGE_CATALOG = [
  { id: 'typescript', name: 'TypeScript', extensions: ['ts', 'tsx', 'mts', 'cts'] },
  { id: 'javascript', name: 'JavaScript', extensions: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'python', name: 'Python', extensions: ['py'] }, { id: 'java', name: 'Java', extensions: ['java'] },
  { id: 'kotlin', name: 'Kotlin', extensions: ['kt', 'kts'] }, { id: 'csharp', name: 'C#', extensions: ['cs'] },
  { id: 'go', name: 'Go', extensions: ['go'] }, { id: 'rust', name: 'Rust', extensions: ['rs'] },
  { id: 'ruby', name: 'Ruby', extensions: ['rb'] }, { id: 'php', name: 'PHP', extensions: ['php'] },
  { id: 'swift', name: 'Swift', extensions: ['swift'] }, { id: 'dart', name: 'Dart', extensions: ['dart'] },
  { id: 'c', name: 'C', extensions: ['c', 'h'] }, { id: 'cpp', name: 'C++', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'] },
] as const;
export type Language = typeof LANGUAGE_CATALOG[number];
export const TECHNOLOGY_KINDS = ['FRAMEWORK', 'RUNTIME', 'PACKAGE_MANAGER', 'BUILD_TOOL', 'TEST_FRAMEWORK', 'DATABASE', 'ORM', 'INFRASTRUCTURE'] as const;
export type TechnologyKind = typeof TECHNOLOGY_KINDS[number];
export const FRAMEWORK_CATALOG = [
  { id: 'nestjs', name: 'NestJS', category: 'BACKEND' }, { id: 'react', name: 'React', category: 'FRONTEND' },
  { id: 'nextjs', name: 'Next.js', category: 'FULL_STACK' }, { id: 'angular', name: 'Angular', category: 'FRONTEND' },
  { id: 'vue', name: 'Vue', category: 'FRONTEND' }, { id: 'express', name: 'Express', category: 'BACKEND' },
  { id: 'fastapi', name: 'FastAPI', category: 'BACKEND' }, { id: 'django', name: 'Django', category: 'BACKEND' },
  { id: 'flask', name: 'Flask', category: 'BACKEND' }, { id: 'spring-boot', name: 'Spring Boot', category: 'BACKEND' },
  { id: 'quarkus', name: 'Quarkus', category: 'BACKEND' }, { id: 'micronaut', name: 'Micronaut', category: 'BACKEND' },
  { id: 'aspnet-core', name: 'ASP.NET Core', category: 'BACKEND' }, { id: 'rails', name: 'Ruby on Rails', category: 'FULL_STACK' },
  { id: 'laravel', name: 'Laravel', category: 'BACKEND' }, { id: 'symfony', name: 'Symfony', category: 'BACKEND' },
  { id: 'flutter', name: 'Flutter', category: 'MOBILE' }, { id: 'vscode-extension', name: 'VS Code Extension', category: 'EXTENSION' },
] as const;
export const PACKAGE_MANAGER_CATALOG = [
  { id: 'npm', name: 'npm', ecosystem: 'javascript' }, { id: 'pnpm', name: 'pnpm', ecosystem: 'javascript' },
  { id: 'yarn', name: 'yarn', ecosystem: 'javascript' }, { id: 'bun', name: 'bun', ecosystem: 'javascript' },
  { id: 'pip', name: 'pip', ecosystem: 'python' }, { id: 'poetry', name: 'poetry', ecosystem: 'python' },
  { id: 'uv', name: 'uv', ecosystem: 'python' }, { id: 'pipenv', name: 'Pipenv', ecosystem: 'python' },
  { id: 'maven', name: 'Maven', ecosystem: 'jvm' }, { id: 'gradle', name: 'Gradle', ecosystem: 'jvm' },
  { id: 'nuget', name: 'NuGet', ecosystem: 'dotnet' }, { id: 'go-modules', name: 'Go modules', ecosystem: 'go' },
  { id: 'cargo', name: 'Cargo', ecosystem: 'rust' }, { id: 'bundler', name: 'Bundler', ecosystem: 'ruby' },
  { id: 'composer', name: 'Composer', ecosystem: 'php' }, { id: 'swift-pm', name: 'Swift Package Manager', ecosystem: 'swift' },
  { id: 'pub', name: 'pub', ecosystem: 'dart' },
] as const;
export const TEST_CATALOG = ['Vitest', 'Jest', 'Pytest', 'JUnit', 'xUnit', 'NUnit', 'RSpec', 'PHPUnit', 'Dart test'] as const;
export const BUILD_CATALOG = ['esbuild', 'Vite', 'Webpack', 'TypeScript', 'Turbo', 'Nx', 'Maven', 'Gradle', 'Go', 'Cargo', 'MSBuild', 'SwiftPM', 'Dart', 'CMake'] as const;
export const PROJECT_KINDS = ['APPLICATION', 'SERVICE', 'LIBRARY', 'PACKAGE', 'TOOL', 'UNKNOWN'] as const;
export interface TechnologyEvidence { readonly type: 'DEPENDENCY' | 'MANIFEST' | 'CONFIGURATION'; readonly relativePath: string; readonly value: string }
export interface DetectedTechnology { readonly id: string; readonly name: string; readonly kind: TechnologyKind; readonly evidence: readonly TechnologyEvidence[] }
export interface TechnologyDefinition { readonly id: string; readonly name: string; readonly kind: TechnologyKind }
const catalog = (kind: TechnologyKind, values: readonly { readonly id: string; readonly name: string }[]): TechnologyDefinition[] => values.map((item) => ({ id: item.id, name: item.name, kind }));
const names = (values: readonly string[]) => values.map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name }));
export const TECHNOLOGY_CATALOG: readonly TechnologyDefinition[] = [
  ...catalog('FRAMEWORK', FRAMEWORK_CATALOG), ...catalog('PACKAGE_MANAGER', PACKAGE_MANAGER_CATALOG),
  ...catalog('BUILD_TOOL', names(BUILD_CATALOG)), ...catalog('TEST_FRAMEWORK', names(TEST_CATALOG)),
  ...catalog('RUNTIME', names(['Node.js', 'Python', 'JVM', '.NET', 'Ruby', 'PHP'])),
  ...catalog('ORM', names(['Prisma', 'SQLAlchemy', 'Hibernate', 'Entity Framework Core'])),
  ...catalog('DATABASE', names(['PostgreSQL', 'MySQL', 'SQLite', 'MongoDB'])),
  ...catalog('INFRASTRUCTURE', names(['Docker', 'GitHub Actions'])),
];
