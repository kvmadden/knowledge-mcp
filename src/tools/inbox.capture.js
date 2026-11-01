import { z } from "zod";
import { provenanceSchema } from "../lib/provenance.js"

export const name = "inbox.capture";
export const access = "write";
export const config = {
  title: "Capture to inbox",
  description: "Capture a note into the inbox. suggested_bucket must be a known bucket id (see inbox.buckets). Every field, including tags, source_app and link_url, is screened before the write.",
  inputSchema: {
    provenance: provenanceSchema.optional(),
    text: z.string().min(1).max(8000).describe("Capture body."),
    source_app: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional().describe("Lowercase kebab-case source label (default knowledge-mcp)."),
    suggested_bucket: z.string().optional().describe("Bucket id hint."),
    tags: z.array(z.string()).optional().describe("Tags."),
    link_url: z.string().max(2000).optional().describe("A related URL."),
  },
};

export function run(args, { records }) {
  const row = records.capture(args);
  return { text: `Captured ${row.id} (bucket: ${row.bucket ?? "unsorted"}).\n\n${JSON.stringify(row, null, 2)}`, structured: row };
}
