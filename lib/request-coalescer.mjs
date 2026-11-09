/** Share only in-flight reads, isolated by account and path. Never cache a response. */
export function createRequestCoalescer() {
  const accounts = new Map();
  return {
    read(account, path, request) {
      let pending = accounts.get(account);
      if (!pending) { pending = new Map(); accounts.set(account, pending); }
      if (pending.has(path)) return pending.get(path);
      const result = Promise.resolve().then(request).finally(() => {
        if (pending.get(path) === result) pending.delete(path);
        if (!pending.size && accounts.get(account) === pending) accounts.delete(account);
      });
      pending.set(path, result);
      return result;
    },
    // Reads started after a write begins or completes must use fresh data.
    invalidate(account) { accounts.delete(account); },
  };
}
