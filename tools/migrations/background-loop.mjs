import { setTimeout as delay } from 'node:timers/promises';
/** Serial ticks; SIGTERM drains the current tick rather than cancelling an in-flight DB transaction. */
export async function runBackgroundLoop({ runOnce, signal, once = false, pollMs = 2000, onTick = () => { }, onError = () => { } }) {
    if (typeof runOnce !== 'function' || !signal || !Number.isSafeInteger(pollMs) || pollMs < 1000 || pollMs > 60000)
        throw new Error('Invalid background worker configuration');
    let consecutiveFailures = 0, ticks = 0;
    while (!signal.aborted) {
        try {
            const result = await runOnce({ signal });
            ticks++;
            consecutiveFailures = 0;
            await onTick(result);
        }
        catch {
            consecutiveFailures++;
            // Do not expose filesystem paths, filenames, DSNs or raw database errors.
            await onError({ code: 'WORKER_TICK_FAILED', consecutiveFailures });
            if (once || consecutiveFailures >= 5)
                throw new Error('WORKER_STOPPED_FOR_REVIEW');
        }
        if (once || signal.aborted)
            break;
        try {
            await delay(Math.min(60000, pollMs * 2 ** consecutiveFailures), undefined, { signal });
        }
        catch (error) {
            if (error.name !== 'AbortError')
                throw error;
        }
    }
    return { ticks, stopped: signal.aborted };
}
