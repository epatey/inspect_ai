// PROTOTYPE — sample open path: shell + skeleton (+ lazily stats) fetch in
// parallel; nothing else is read until the transcript asks for a window.

import { makeStores } from "./chunks";
import { fetchJson } from "./fetchLog";
import { SkeletonIndex } from "./skeletonIndex";
import type { ChunkStats, Shell, Skeleton } from "./types";

export interface LoadedSample {
  path: string;
  shell: Shell;
  skel: SkeletonIndex;
  stats: ChunkStats[];
  stores: ReturnType<typeof makeStores>;
}

export async function openSample(path: string): Promise<LoadedSample> {
  const [shell, skeleton, stats] = await Promise.all([
    fetchJson<Shell>(`${path}/sample.json`, "shell"),
    fetchJson<Skeleton>(`${path}/skeleton.json`, "skeleton"),
    fetchJson<ChunkStats[]>(`${path}/events/stats.json`, "stats"),
  ]);
  return { path, shell, skel: new SkeletonIndex(skeleton), stats, stores: makeStores(path, shell) };
}
