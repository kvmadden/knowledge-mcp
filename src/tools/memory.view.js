import { z } from "zod";

export const name = "memory.view";
export const access = "read";
export const config = {
  title: "View memory",
  description: "List a /memories directory or show a file with line numbers. Optional view_range [from, to], 1-indexed; to = -1 means end of file.",
  inputSchema: {
    path: z.string().describe("Path under /memories, e.g. /memories or /memories/notes/style.md."),
    view_range: z.array(z.number().int()).length(2).optional().describe("[from, to] line range."),
  },
};

export function run(args, { memory }) {
  return { text: memory.view(args) };
}
