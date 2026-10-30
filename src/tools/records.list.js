import { z } from "zod";
import { RECORD_TYPES } from "../lib/records.js";

export const name = "records.list";
export const access = "read";
export const config = {
  title: "List records",
  description: "List recent records, newest update first. Returns short projections; use records.get for full text and meta.",
  inputSchema: {
    type: z.enum(RECORD_TYPES).optional().describe("Filter by meta.type."),
    bucket: z.string().optional().describe("Filter by bucket id."),
    buckets: z.array(z.string()).optional().describe("Filter by a set of bucket ids. Takes precedence over bucket."),
    since: z.string().optional().describe("ISO timestamp; only records updated at or after this point."),
    titledOnly: z.boolean().optional().describe("Only records that carry a curated title."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
};

export function run(args, { records }) {
  const rows = records.list(args ?? {});
  return { text: rows.length ? `Found ${rows.length} record(s).\n\n${JSON.stringify(rows, null, 2)}` : "No records matched the filters." };
}
