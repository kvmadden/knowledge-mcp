import { z } from "zod";

export const name = "inbox.search";
export const access = "read";
export const config = {
  title: "Search records",
  description: 'Case-insensitive text search over record text, titles, summaries and tags. Bare words must all appear, "quoted phrases" match verbatim, -word excludes.',
  inputSchema: {
    query: z.string().min(1).max(2000).describe("Search text."),
    bucket: z.string().optional().describe("Bucket id to scope to."),
    sourceApp: z.string().optional().describe("Restrict to one source_app."),
    since: z.string().optional().describe("ISO timestamp; only rows created at or after this point."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 25)."),
  },
};

export function run(args, { records }) {
  const rows = records.search(args);
  return { text: rows.length ? `Found ${rows.length} match(es).\n\n${JSON.stringify(rows, null, 2)}` : "No rows matched." };
}
