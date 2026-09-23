import { useEffect, useRef } from 'react';

const MAX_BACKOFF_MS = 60_000;

/**
 * Runs `tick` every `intervalMs` while the tab is visible. A hidden tab pauses
 * polling; becoming visible again ticks immediately. Failures back off
 * exponentially up to one minute and reset on the next success.
 */
export function useVisiblePolling(tick: () => Promise<void>, intervalMs: number, enabled: boolean): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let running = false;
    let stopped = false;

    const schedule = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      const delay = failures === 0 ? intervalMs : Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS);
      timer = setTimeout(run, delay);
    };

    const run = async () => {
      timer = null;
      if (running || stopped) return;
      running = true;
      try {
        await tickRef.current();
        failures = 0;
      } catch {
        failures += 1;
      } finally {
        running = false;
        schedule();
      }
    };

    const onVisibility = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === 'visible') void run();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs]);
}
