import { z } from "zod";

export const name = "memory.create";
export const access = "write";
export const config = {
  title: "Create memory file",
  description: "Create or overwrite a file under /memories. Path and content are screened; a deny-list match rejects the write.",
  inputSchema: {
    path: z.string().describe("Path under /memories."),
    file_text: z.string().max(100000).describe("File content."),
  },
};

export function run(args, { memory }) {
  return { text: memory.create(args) };
}
