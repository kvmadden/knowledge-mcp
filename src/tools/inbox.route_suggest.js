import { z } from "zod";
import { suggestBucket } from "../lib/route-suggest.js";

export const name = "inbox.route_suggest";
export const access = "read";
export const config = {
  title: "Suggest bucket",
  description: 'Suggest a bucket for some text without saving it. Keyword overlap with bucket descriptions only; confidence is capped at 0.49 and the response carries source: "keyword-heuristic".',
  inputSchema: { text: z.string().min(1).max(8000).describe("Candidate text.") },
};

export function run({ text }, { buckets, defaultBucket }) {
  return { text: JSON.stringify(suggestBucket(text, buckets, defaultBucket), null, 2) };
}
