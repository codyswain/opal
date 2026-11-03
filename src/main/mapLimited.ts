/** Maps every item with at most `limit` calls in flight, keeping the input order in the result. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Thrown to a caller whose job ran past its time. */
export class JobTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} took longer than ${ms} ms`);
    this.name = 'JobTimeoutError';
  }
}

export interface JobOptions {
  /** Jobs for what is on screen run before the rest. */
  visible?: boolean;
  /** The caller gets a JobTimeoutError after this long. */
  timeoutMs: number;
  /** Named in the timeout error. */
  label?: string;
}

interface Waiting {
  start: () => void;
  visible: boolean;
}

/**
 * A standing queue for jobs that arrive one by one, as thumbnails do while
 * a page scrolls: at most `concurrency` at once, visible ones first, each raced
 * against its timeout. A job that times out keeps its slot until it settles
 * or until three times its timeout has passed, so a hung Quick Look or sips
 * call can't start an unbounded pile of others behind the caller's back,
 * and can't hold the slot forever either.
 */
export function jobQueue(concurrency: number) {
  let running = 0;
  const waiting: Waiting[] = [];

  const next = () => {
    while (running < concurrency && waiting.length > 0) {
      const index = waiting.findIndex((job) => job.visible);
      const [job] = waiting.splice(index === -1 ? 0 : index, 1);
      running += 1;
      job.start();
    }
  };

  function run<T>(job: () => Promise<T>, options: JobOptions): Promise<T> {
    const { visible = false, timeoutMs, label = 'Job' } = options;
    return new Promise<T>((resolve, reject) => {
      waiting.push({
        visible,
        start: () => {
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            running -= 1;
            next();
          };
          const timer = setTimeout(() => reject(new JobTimeoutError(label, timeoutMs)), timeoutMs);
          const hardLimit = setTimeout(release, timeoutMs * 3);
          let work: Promise<T>;
          try {
            work = job();
          } catch (error) {
            work = Promise.reject(error);
          }
          work.then(resolve, reject).finally(() => {
            clearTimeout(timer);
            clearTimeout(hardLimit);
            release();
          });
        },
      });
      next();
    });
  }

  return {
    run,
    /** Jobs started and not yet released. */
    get running() { return running; },
    get waiting() { return waiting.length; },
  };
}

export type JobQueue = ReturnType<typeof jobQueue>;
