import { z } from "zod";

export const name = "memory.delete";
export const access = "write";
export const config = {
  title: "Delete memory file or directory",
  description: "Delete a file, or every file under a directory path.",
  inputSchema: { path: z.string().describe("Path under /memories.") },
};

export function run(args, { memory }) {
  return { text: memory.delete(args) };
}
