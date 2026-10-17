/** Coordinate reads from the mounted dashboard without reloading its session. */
export function createProductionRefresh(timeoutMs = 25_000) {
  const readers = new Set();
  let pending = null;
  let activeReaders = [];
  return {
    register(reader) { readers.add(reader); return () => { readers.delete(reader); }; },
    run() {
      if (pending) {
        if ([...readers].every(reader => activeReaders.includes(reader))) return pending;
        // Navigation can mount new sources while the previous page refreshes.
        // Queue a fresh pass so that page is never reported as already updated.
        return pending.catch(() => {}).then(() => this.run());
      }
      let timer;
      activeReaders = [...readers];
      const reads = Promise.allSettled(activeReaders.map(reader => Promise.resolve().then(reader))).then(results => {
        if (results.some(result => result.status === 'rejected' || result.value === false)) {
          throw new Error('Some updates couldn’t load. Check your connection and pull again.');
        }
      });
      pending = Promise.race([reads, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Refresh took too long. Check your connection and pull again.')), timeoutMs);
      })]).finally(() => { clearTimeout(timer); pending = null; });
      return pending;
    },
  };
}

