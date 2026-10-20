import worker from '../../team-api/worker.mjs';
const cache = new WeakMap();
export async function testSessionToken(env, proof, machine = false) {
  if (machine || typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return proof;
  if (!cache.has(env)) cache.set(env, new Map());
  const sessions = cache.get(env);
  const existing = sessions.get(proof);
  if (existing) {
    const current = await existing;
    if (current?.expiresAt > Date.now()) return current.token;
    if (sessions.get(proof) !== existing) return (await sessions.get(proof)).token;
  }
  const pending = (async () => {
    const response = await worker.fetch(new Request('https://api.example.invalid/auth/session', { method: 'POST', headers: { authorization: `Bearer ${proof}` } }), env, { waitUntil() {} });
    const result = await response.json();
    return response.ok ? result : { token: proof, expiresAt: 0 };
  })();
  sessions.set(proof, pending);
  return (await pending).token;
}
