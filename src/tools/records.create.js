import { z } from "zod";
import { provenanceSchema } from "../lib/provenance.js"
import { RECORD_TYPES } from "../lib/records.js";

export const name = "records.create";
export const access = "write";
export const config = {
  title: "Create record",
  description: "Create a record. A title marks it as filed (organized under a title, not reviewed). Every field is screened before the write: a listed pattern rejects the whole write, and content the gate cannot judge (for example a clinical rule or an instruction aimed at an AI) is held for a reviewer instead of saved.",
  inputSchema: {
    provenance: provenanceSchema.optional(),
    text: z.string().min(1).max(20000).describe("Body text."),
    type: z.enum(RECORD_TYPES).optional().describe("meta.type; defaults to note."),
    bucket: z.string().optional().describe("Bucket id (see inbox.buckets)."),
    title: z.string().max(200).optional().describe("Title. Presence marks the record as filed."),
    summary: z.string().max(2000).optional().describe("One-paragraph summary."),
    tags: z.array(z.string().max(64)).max(32).optional().describe("Free-form tags."),
  },
};

export function run(args, { records }) {
  const row = records.create(args);
  return { text: `Created record ${row.id} (${row.type}).\n\n${JSON.stringify(row, null, 2)}` };
}
