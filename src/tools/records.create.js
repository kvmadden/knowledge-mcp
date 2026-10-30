import { z } from "zod";
import { RECORD_TYPES } from "../lib/records.js";

export const name = "records.create";
export const access = "write";
export const config = {
  title: "Create record",
  description: "Create a record. A title marks it as filed (curated) rather than an inbox item. Every field is screened before the write; a deny-list match rejects the whole write.",
  inputSchema: {
    text: z.string().min(1).max(20000).describe("Body text."),
    type: z.enum(RECORD_TYPES).optional().describe("meta.type; defaults to note."),
    bucket: z.string().optional().describe("Bucket id (see inbox.buckets)."),
    title: z.string().optional().describe("Curated title. Presence marks the record as filed."),
    summary: z.string().optional().describe("One-paragraph summary, stored with the title."),
    tags: z.array(z.string()).optional().describe("Free-form tags."),
  },
};

export function run(args, { records }) {
  const row = records.create(args);
  return { text: `Created record ${row.id} (${row.type}).\n\n${JSON.stringify(row, null, 2)}` };
}
