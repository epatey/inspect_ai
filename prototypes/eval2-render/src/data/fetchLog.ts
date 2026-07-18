// PROTOTYPE — instrumented fetch: counts requests/bytes per sequence and adds
// artificial latency so scroll-velocity-vs-fetch-latency is observable.

export interface FetchStats {
  requests: number;
  bytes: number;
  bySequence: Record<string, number>;
  inflight: number;
}

export const stats: FetchStats = { requests: 0, bytes: 0, bySequence: {}, inflight: 0 };

let latencyMs = 0;
export const setLatency = (ms: number) => (latencyMs = ms);
export const getLatency = () => latencyMs;

type Listener = () => void;
const listeners = new Set<Listener>();
export const onStatsChange = (fn: Listener) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const notify = () => listeners.forEach((fn) => fn());

export async function fetchJson<T>(path: string, sequence: string): Promise<T> {
  stats.requests += 1;
  stats.inflight += 1;
  stats.bySequence[sequence] = (stats.bySequence[sequence] ?? 0) + 1;
  notify();
  try {
    if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
    const res = await fetch(`/data/${path}`);
    if (!res.ok) throw new Error(`${res.status} fetching ${path}`);
    const text = await res.text();
    stats.bytes += text.length;
    return JSON.parse(text) as T;
  } finally {
    stats.inflight -= 1;
    notify();
  }
}

export function resetStats() {
  stats.requests = 0;
  stats.bytes = 0;
  stats.bySequence = {};
  notify();
}
