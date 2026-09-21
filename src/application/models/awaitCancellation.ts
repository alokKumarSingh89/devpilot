import type { RequestCancellation } from './ports';
import { ModelFailure } from './ModelFailure';

/** Settle promptly even if a provider delays honoring cancellation; late results are ignored. */
export function awaitCancellation<T>(operation: PromiseLike<T>, token: RequestCancellation): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let subscription: { dispose(): void } | undefined;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true; subscription?.dispose(); complete();
    };
    subscription = token.onCancellationRequested(() => finish(() => reject(new ModelFailure('CANCELLED'))));
    if (token.isCancellationRequested) finish(() => reject(new ModelFailure('CANCELLED')));
    if (settled) subscription.dispose();
    Promise.resolve(operation).then((value) => finish(() => resolve(value)), (error: unknown) => finish(() => reject(error)));
  });
}
