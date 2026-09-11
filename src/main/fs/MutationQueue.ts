/** Serializes app filesystem changes. Failed operations do not poison the queue. */
export class MutationQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export const filesystemMutationQueue = new MutationQueue();
