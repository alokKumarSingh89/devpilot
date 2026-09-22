import type { DetectedTechnology } from '../../../domain/repository/technology';
import type { DetectorInput, TechnologyDetector } from './ecosystems/contracts';
import { javascriptDetector } from './ecosystems/javascript';
import { pythonDetector } from './ecosystems/python';
import { jvmDetector } from './ecosystems/jvm';
import { dartDetector, dotnetDetector, phpDetector, rubyDetector } from './ecosystems/otherEcosystems';
import { manifestFactsDetector } from './ecosystems/manifestFacts';
/** Internal detector registry. No extension loading, process execution or public plugin API. */
export const TECHNOLOGY_DETECTORS: readonly TechnologyDetector[] = [manifestFactsDetector, javascriptDetector, pythonDetector, jvmDetector, dotnetDetector, rubyDetector, phpDetector, dartDetector];
export function detectTechnologies(inputs: readonly DetectorInput[], invalidMetadata: () => void): DetectedTechnology[] {
  const grouped = new Map<string, DetectedTechnology>();
  for (const input of inputs) for (const detector of TECHNOLOGY_DETECTORS) {
    if (!detector.supports(input)) continue;
    try {
      for (const finding of detector.detect(input)) {
        const key = `${finding.kind}:${finding.id}`; const previous = grouped.get(key);
        const refs = [...previous?.evidence ?? [], ...finding.evidence];
        const evidence = [...new Map(refs.map((ref) => [JSON.stringify(ref), ref])).values()];
        grouped.set(key, { ...finding, evidence });
      }
    } catch { invalidMetadata(); }
  }
  return [...grouped].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, finding]) => finding);
}
