import type { RequestCancellation } from '../models/ports';

/** Owned cancellation scope links notification cancellation and extension shutdown without editor dependencies. */
export class AnalysisCancellation implements RequestCancellation {
  isCancellationRequested = false;
  private readonly listeners = new Set<() => void>();
  private readonly subscription: { dispose(): void };
  constructor(parent: RequestCancellation) {
    this.subscription = parent.onCancellationRequested(() => this.cancel());
    if (parent.isCancellationRequested) this.cancel();
  }
  onCancellationRequested(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
  cancel(): void {
    if (this.isCancellationRequested) return;
    this.isCancellationRequested = true;
    this.listeners.forEach((listener) => listener());
  }
  dispose(): void { this.subscription.dispose(); this.listeners.clear(); }
}
