import { z } from "zod";

export const name = "records.pin";
export const access = "write";
export const config = {
  title: "Pin record",
  description: "Pin or unpin a record (meta.pinned, meta.pinnedAt).",
  inputSchema: {
    id: z.string().min(1).describe("Record id."),
    pinned: z.boolean().optional().describe("Defaults to true. Pass false to unpin."),
  },
};

export function run({ id, pinned }, { records }) {
  const result = records.pin({ id, pinned: pinned ?? true });
  return { text: result.pinned ? `Pinned ${result.id} at ${result.pinnedAt}.` : `Unpinned ${result.id}.` };
}
