import { z } from "zod";

export const name = "inbox.buckets";
export const access = "read";
export const config = {
  title: "List buckets",
  description: "List the bucket ids records can be filed under, and the default.",
  inputSchema: { include_descriptions: z.boolean().optional().describe("Include descriptions (default true).") },
};

export function run(args, { buckets, defaultBucket }) {
  const withDesc = args?.include_descriptions !== false;
  const list = buckets.map((b) => ({ id: b.id, label: b.label, parent: b.parent ?? null, ...(withDesc && { description: b.description }) }));
  return { text: JSON.stringify({ count: list.length, default: defaultBucket, buckets: list }, null, 2) };
}
