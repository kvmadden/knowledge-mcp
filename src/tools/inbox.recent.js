import { z } from "zod";

export const name = "inbox.recent";
export const access = "read";
export const config = {
  title: "Recent inbox",
  description: "List the most recently created records, newest first, including untriaged captures.",
  inputSchema: {
    bucket: z.string().optional().describe("Bucket id to scope to."),
    since: z.string().optional().describe("ISO timestamp; only rows created at or after this point."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 25)."),
  },
};

export function run(args, { records }) {
  const rows = records.recent(args ?? {});
  return { text: rows.length ? `Found ${rows.length} recent row(s).\n\n${JSON.stringify(rows, null, 2)}` : "No recent rows matched the filters." };
}
