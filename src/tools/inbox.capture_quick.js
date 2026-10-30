import { z } from "zod";

export const name = "inbox.capture_quick";
export const access = "write";
export const config = {
  title: "Quick capture",
  description: "Capture a note with a single text field. Same destination and same screening as inbox.capture.",
  inputSchema: { text: z.string().min(1).max(8000).describe("Capture body.") },
};

export function run({ text }, { records }) {
  const row = records.capture({ text, tags: ["quick"] });
  return { text: `Captured ${row.id}.` };
}
