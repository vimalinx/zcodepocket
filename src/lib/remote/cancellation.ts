export function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error('页面已离开');
    error.name = 'AbortError';
    throw error;
  }
}

// Stops local waiting only, without replaying or claiming to cancel remote work.
export function waitForRequest<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { try { checkCancelled(signal); } catch (error) { reject(error); } };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
