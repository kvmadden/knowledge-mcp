import { z } from "zod";

export const name = "memory.insert";
export const access = "write";
export const config = {
  title: "Insert text into memory file",
  description: "Insert text at a 0-indexed line position. The resulting file content is screened before the write.",
  inputSchema: {
    path: z.string().describe("Path under /memories."),
    insert_line: z.number().int().min(0).describe("0 prepends; the line count appends."),
    insert_text: z.string().max(100000).describe("Text to insert."),
  },
};

export function run(args, { memory }) {
  return { text: memory.insert(args) };
}
