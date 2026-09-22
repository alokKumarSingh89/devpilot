import { AnalysisValidationFailure, diagnosticFailure } from '../../domain/requirements/analysisContract';
import { MAX_ANALYSIS_RESPONSE_CHARACTERS } from '../../domain/requirements/requirements';

function invalid(reason: string): never { return diagnosticFailure('$response', 'one complete JSON object', undefined, reason); }

/** JSON.parse checks syntax; this pass rejects duplicate keys (including escaped aliases) and excessive nesting. */
function checkStructure(json: string): void {
  const stack: (Set<string> | null)[] = [];
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (char === '"') {
      const start = index++;
      while (index < json.length && json[index] !== '"') {
        if (json[index] === '\\') index++;
        index++;
      }
      let next = index + 1;
      while (/\s/.test(json[next] ?? '') && next < json.length) next++;
      if (json[next] === ':') {
        const key: unknown = JSON.parse(json.slice(start, index + 1));
        const keys = stack.at(-1);
        if (typeof key !== 'string' || !keys || keys.has(key)) invalid('Duplicate keys or excessive nesting are not allowed');
        keys.add(key);
      }
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? new Set() : null);
      if (stack.length > 32) invalid('Duplicate keys or excessive nesting are not allowed');
    } else if (char === '}' || char === ']') stack.pop();
  }
}

/** Accepts whitespace or exactly one JSON fence. Never searches prose for JSON or repairs it. */
export function parseAnalysisResponse(response: string): unknown {
  try {
    if (response.length > MAX_ANALYSIS_RESPONSE_CHARACTERS) invalid('Response exceeds the character limit');
    let json = response.trim();
    if (json.startsWith('```')) {
      const fenced = /^```json\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(json);
      if (!fenced?.[1]) invalid('Expected one complete JSON fence; response may be incomplete or truncated');
      json = fenced[1].trim();
    }
    if (!json.startsWith('{')) invalid('Explanatory prose and non-object JSON are not supported');
    if (!json.endsWith('}')) invalid('Requirements analysis response appears incomplete or truncated');
    const value: unknown = JSON.parse(json);
    checkStructure(json);
    return value;
  } catch (error) {
    if (error instanceof AnalysisValidationFailure) throw error;
    invalid('Malformed JSON; response may be incomplete or truncated. No repair attempted');
  }
}
