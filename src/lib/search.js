// Small query matcher for the in-memory store. Syntax:
//   bare words      all must appear (case-insensitive)
//   "quoted phrase" must appear verbatim (case-insensitive)
//   -word           must not appear

export function parseQuery(query) {
  const include = [];
  const exclude = [];
  const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
  let m;
  while ((m = re.exec(String(query ?? ""))) !== null) {
    const negated = Boolean(m[1] || m[3]);
    const term = (m[2] ?? m[4]).toLowerCase();
    if (!term) continue;
    (negated ? exclude : include).push(term);
  }
  return { include, exclude };
}

export function matchesQuery(query, text) {
  const { include, exclude } = parseQuery(query);
  if (!include.length && !exclude.length) return false;
  const haystack = String(text ?? "").toLowerCase();
  return include.every((t) => haystack.includes(t)) && !exclude.some((t) => haystack.includes(t));
}
