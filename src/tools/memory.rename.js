import { z } from "zod";

export const name = "memory.rename";
export const access = "write";
export const config = {
  title: "Rename memory file or directory",
  description: "Move a file or directory. Never overwrites. The new path is screened before the write.",
  inputSchema: {
    old_path: z.string().describe("Current path under /memories."),
    new_path: z.string().describe("New path under /memories; must not exist."),
  },
};

export function run(args, { memory }) {
  return { text: memory.rename(args) };
}
