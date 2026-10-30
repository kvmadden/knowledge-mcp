// Keyword-overlap bucket suggester. Labeled as a heuristic in every response;
// it is not a trained classifier.

const STOPWORDS = new Set(
  "the a an and or but if then of to in on at by for with is are was were be been this that these those it its i me my you your we our they them their do did does have has had not no from as so than too very just also more some".split(" "),
);

export const HEURISTIC_CONFIDENCE_CAP = 0.49;

function tokens(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map((t) => t.replace(/s$/, ""));
}

export function suggestBucket(text, buckets, defaultId = "unsorted") {
  const input = new Set(tokens(text));
  let best = null;
  for (const bucket of buckets) {
    const keywords = new Set(tokens(`${bucket.label} ${bucket.description}`));
    let overlap = 0;
    for (const t of input) if (keywords.has(t)) overlap += 1;
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { bucket, overlap };
  }
  if (!best) {
    return { bucket_id: defaultId, confidence: 0, source: "keyword-heuristic", matched_terms: 0 };
  }
  const confidence = Math.min(HEURISTIC_CONFIDENCE_CAP, Number((best.overlap / Math.max(3, input.size)).toFixed(2)));
  return { bucket_id: best.bucket.id, confidence, source: "keyword-heuristic", matched_terms: best.overlap };
}
