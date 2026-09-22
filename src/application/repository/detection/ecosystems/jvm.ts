import { finding, withoutComments, type TechnologyDetector } from './contracts';
export const jvmDetector: TechnologyDetector = {
  id: 'jvm', supports: (input) => input.type === 'MAVEN' || input.type === 'GRADLE',
  detect(input) {
    if (input.text === undefined) return [];
    const clean = withoutComments(input.text); const groups = new Set<string>();
    if (input.type === 'MAVEN') {
      for (const block of clean.matchAll(/<(dependency|parent|plugin)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
        const group = /<groupId>\s*([\w.-]+)\s*<\/groupId>/.exec(block[2] ?? '')?.[1];
        if (group) groups.add(group);
      }
    } else {
      for (const match of clean.matchAll(/(?:^|[;{])\s*(?:implementation|api|testImplementation|runtimeOnly|id)\s*\(?\s*["']([\w.-]+)(?::|["'])/gm)) if (match[1]) groups.add(match[1]);
    }
    const rules = [
      ['org.springframework.boot', 'FRAMEWORK', 'Spring Boot'], ['io.quarkus', 'FRAMEWORK', 'Quarkus'], ['io.micronaut', 'FRAMEWORK', 'Micronaut'],
      ['io.micronaut.application', 'FRAMEWORK', 'Micronaut'], ['org.hibernate', 'ORM', 'Hibernate'], ['org.hibernate.orm', 'ORM', 'Hibernate'],
      ['org.postgresql', 'DATABASE', 'PostgreSQL'], ['org.junit', 'TEST_FRAMEWORK', 'JUnit'], ['org.junit.jupiter', 'TEST_FRAMEWORK', 'JUnit'], ['junit', 'TEST_FRAMEWORK', 'JUnit'],
    ] as const;
    return rules.filter(([group]) => groups.has(group)).map(([group, kind, name]) => finding(input, kind, name, group));
  },
};
