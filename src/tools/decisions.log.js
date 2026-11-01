import { z } from "zod";
import { provenanceSchema } from "../lib/provenance.js"

export const name = "decisions.log";
export const access = "write";
export const config = {
  title: "Log decision",
  description: "Record a decision with a title, optional summary and optional context. Every field is screened before the write.",
  inputSchema: {
    provenance: provenanceSchema.optional(),
    title: z.string().min(1).max(200).describe("Decision headline."),
    summary: z.string().optional().describe("One-paragraph summary."),
    context: z.string().optional().describe("Why, alternatives considered. Stored as the body text."),
    bucket: z.string().optional().describe("Bucket id."),
  },
};

export function run(args, { records }) {
  const row = records.logDecision(args);
  return { text: `Logged decision ${row.id}.\n\n${JSON.stringify(row, null, 2)}` };
}
