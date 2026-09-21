import { AnalysisFailure } from '../../domain/requirements/AnalysisFailure';
import { MAX_ANALYSIS_RESPONSE_CHARACTERS } from '../../domain/requirements/requirements';

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
        if (typeof key !== 'string' || !keys || keys.has(key)) throw new AnalysisFailure('INVALID_OUTPUT');
        keys.add(key);
      }
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? new Set() : null);
      if (stack.length > 32) throw new AnalysisFailure('INVALID_OUTPUT');
    } else if (char === '}' || char === ']') stack.pop();
  }
}

/** Accepts whitespace or exactly one JSON fence. Never searches prose for JSON or repairs it. */
export function parseAnalysisResponse(response: string): unknown {
  try {
    if (response.length > MAX_ANALYSIS_RESPONSE_CHARACTERS) throw new AnalysisFailure('INVALID_OUTPUT');
    let json = response.trim();
    if (json.startsWith('```')) {
      const fenced = /^```json\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(json);
      if (!fenced?.[1]) throw new AnalysisFailure('INVALID_OUTPUT');
      json = fenced[1].trim();
    }
    if (!json.startsWith('{') || !json.endsWith('}')) throw new AnalysisFailure('INVALID_OUTPUT');
    const value: unknown = JSON.parse(json);
    checkStructure(json);
    return value;
  } catch { throw new AnalysisFailure('INVALID_OUTPUT'); }
}
