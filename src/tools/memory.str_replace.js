import { z } from "zod";

export const name = "memory.str_replace";
export const access = "write";
export const config = {
  title: "Replace text in memory file",
  description: "Replace a unique occurrence of old_str with new_str. The resulting file content is screened before the write.",
  inputSchema: {
    path: z.string().describe("Path under /memories."),
    old_str: z.string().max(100000).describe("Exact text to replace; must occur once."),
    new_str: z.string().max(100000).describe("Replacement text."),
  },
};

export function run(args, { memory }) {
  return { text: memory.str_replace(args) };
}
