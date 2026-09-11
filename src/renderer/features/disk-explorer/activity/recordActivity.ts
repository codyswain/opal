/**
 * Explicit-open recording. Fire and forget: navigation never waits on activity,
 * and a missing bridge (standalone explorer harnesses, tests) is silent.
 */
export function recordOpened(path: string): void {
  const api = typeof window !== 'undefined' ? window.activityAPI : undefined;
  if (!api) return;
  try {
    void Promise.resolve(api.record(path, 'opened'))
      .then((result) => {
        if (result && !result.success) {
          console.warn(`Activity not recorded: ${result.error}`);
        }
      })
      .catch((error) => console.warn('Activity not recorded', error));
  } catch (error) {
    console.warn('Activity not recorded', error);
  }
}
