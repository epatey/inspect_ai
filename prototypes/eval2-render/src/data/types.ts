// PROTOTYPE — minimal structural types for .eval2 artifacts (not the generated
// viewer types; the prototype reads only these fields).

export type SequenceName = "messages" | "events" | "calls" | "attachments";

export interface Shell {
  id: string | number;
  epoch: number;
  /** cumulative end-exclusive chunk boundaries; last element = sequence count */
  sequences: Record<SequenceName, number[]>;
  /** final conversation as half-open ranges into the message sequence */
  message_refs: [number, number][];
}

export interface EventLite {
  event: string;
  span_id?: string | null;
  /** span id on span_begin / span_end */
  id?: string;
  parent_id?: string | null;
  name?: string;
  type?: string | null;
  timestamp?: string;
  function?: string;
  action?: string;
  model?: string;
  input_refs?: [number, number][] | null;
  output?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

export interface MessageLite {
  id?: string;
  role: string;
  content: unknown;
}

export interface SkeletonSpan {
  id: string;
  parent: number | null;
  name: string | null;
  type: string | null;
  begin: number;
  extent: [number, number];
  t: [string, string];
  working: [number | null, number | null];
  events: number;
  models: number;
  gap_models: number[];
  children: Record<string, number>;
}

export interface Notable {
  i: number;
  span: number;
  type: string;
}

export interface Skeleton {
  version: number;
  counts: { events: number; models: number };
  spans: SkeletonSpan[];
  notables: Notable[];
  notables_overflow?: Record<string, boolean>;
}

export interface ChunkStats {
  start: number;
  type_counts: Record<string, number>;
  first: { type: string; span_id: string | null } | null;
  last: { type: string; span_id: string | null } | null;
}
