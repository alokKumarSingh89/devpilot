import { MAX_EVIDENCE_LENGTH } from './requirements';

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();
interface QuoteMetrics { readonly quoteLength: number; readonly normalizedQuoteLength: number }
export type QuoteVerification = QuoteMetrics & (
  | { readonly result: 'VERIFIED'; readonly evidence: string; readonly occurrences: 1 | 2 }
  | { readonly result: 'NOT_FOUND'; readonly reason: 'EMPTY' | 'TOO_LONG' | 'NOT_CONTIGUOUS'; readonly occurrences: 0 }
);
/** Proves normalized textual presence, never semantic support or authority. No fuzzy matching. */
export class SourceTraceabilityVerifier {
  private readonly source: string;
  constructor(prdText: string) { this.source = normalizeWhitespace(prdText); }
  verifyQuote(quote: string): QuoteVerification {
    const normalized = normalizeWhitespace(quote);
    const metrics = { quoteLength: quote.length, normalizedQuoteLength: normalized.length };
    if (!normalized) return { ...metrics, result: 'NOT_FOUND', reason: 'EMPTY', occurrences: 0 };
    if (quote.trim().length > MAX_EVIDENCE_LENGTH) return { ...metrics, result: 'NOT_FOUND', reason: 'TOO_LONG', occurrences: 0 };
    const start = this.source.indexOf(normalized);
    if (start < 0) return { ...metrics, result: 'NOT_FOUND', reason: 'NOT_CONTIGUOUS', occurrences: 0 };
    // A repeated literal quote still proves provenance. Location is non-unique; section is navigation only.
    const occurrences = this.source.indexOf(normalized, start + 1) < 0 ? 1 : 2;
    return { ...metrics, result: 'VERIFIED', evidence: this.source.slice(start, start + normalized.length), occurrences };
  }
}
