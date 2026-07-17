let n = 0;

/** Locally-unique id for optimistic client-side rows, e.g. "mod-ly3k2a-1". */
export function uid(prefix = "id"): string {
  n += 1;
  return `${prefix}-${Date.now().toString(36)}-${n}`;
}
