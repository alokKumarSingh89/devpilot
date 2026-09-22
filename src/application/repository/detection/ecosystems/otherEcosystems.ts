import { parseDocument } from 'yaml';
import { dependencyFindings, finding, json, object, withoutComments, type TechnologyDetector } from './contracts';
export const dotnetDetector: TechnologyDetector = {
  id: 'dotnet', supports: (input) => input.type === 'DOTNET_PROJECT', detect(input) {
    const clean = withoutComments(input.text ?? ''); const dependencies = new Set<string>();
    for (const match of clean.matchAll(/<(?:PackageReference|FrameworkReference)\b[^>]*\b(?:Include|Update)\s*=\s*["']([^"']+)["']/g)) if (match[1]) dependencies.add(match[1].toLowerCase());
    const result = dependencyFindings(input, dependencies, [
      { dependency: 'microsoft.aspnetcore.app', kind: 'FRAMEWORK', name: 'ASP.NET Core' },
      { dependency: 'microsoft.entityframeworkcore', kind: 'ORM', name: 'Entity Framework Core' },
      { dependency: 'npgsql', kind: 'DATABASE', name: 'PostgreSQL' }, { dependency: 'xunit', kind: 'TEST_FRAMEWORK', name: 'xUnit' }, { dependency: 'nunit', kind: 'TEST_FRAMEWORK', name: 'NUnit' },
    ]);
    if (/<Project\b[^>]*\bSdk\s*=\s*["']Microsoft\.NET\.Sdk\.Web["']/.test(clean)) result.push(finding(input, 'FRAMEWORK', 'ASP.NET Core', 'Microsoft.NET.Sdk.Web', 'CONFIGURATION'));
    return result;
  },
};
export const rubyDetector: TechnologyDetector = {
  id: 'ruby', supports: (input) => input.type === 'RUBY_GEMFILE', detect(input) {
    const dependencies = new Set<string>();
    for (const match of withoutComments(input.text ?? '').matchAll(/^\s*gem\s*\(?\s*["']([\w-]+)["']/gm)) if (match[1]) dependencies.add(match[1]);
    return dependencyFindings(input, dependencies, [{ dependency: 'rails', kind: 'FRAMEWORK', name: 'Ruby on Rails' }, { dependency: 'rspec', kind: 'TEST_FRAMEWORK', name: 'RSpec' }, { dependency: 'rspec-rails', kind: 'TEST_FRAMEWORK', name: 'RSpec' }, { dependency: 'pg', kind: 'DATABASE', name: 'PostgreSQL' }]);
  },
};
export const phpDetector: TechnologyDetector = {
  id: 'php', supports: (input) => input.type === 'PHP_COMPOSER', detect(input) {
    if (input.text === undefined) return [];
    const data = json(input.text); const dependencies = new Set(['require', 'require-dev'].flatMap((key) => Object.keys(object(data[key]))));
    return dependencyFindings(input, dependencies, [{ dependency: 'laravel/framework', kind: 'FRAMEWORK', name: 'Laravel' }, { dependency: 'symfony/framework-bundle', kind: 'FRAMEWORK', name: 'Symfony' }, { dependency: 'phpunit/phpunit', kind: 'TEST_FRAMEWORK', name: 'PHPUnit' }]);
  },
};
export const dartDetector: TechnologyDetector = {
  id: 'dart', supports: (input) => input.type === 'DART_PACKAGE', detect(input) {
    if (input.text === undefined) return [];
    const document = parseDocument(input.text, { schema: 'core', uniqueKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length) throw new Error('Invalid package manifest');
    const data = object(document.toJS({ maxAliasCount: 0 }) as unknown);
    const result = [];
    for (const key of ['dependencies', 'dev_dependencies']) {
      const dependencies = object(data[key]);
      if (object(dependencies.flutter).sdk === 'flutter') result.push(finding(input, 'FRAMEWORK', 'Flutter', 'flutter sdk dependency'));
      if (Object.hasOwn(dependencies, 'flutter_test') || Object.hasOwn(dependencies, 'test')) result.push(finding(input, 'TEST_FRAMEWORK', 'Dart test', 'test dependency'));
    }
    return result;
  },
};
