import { z } from "zod";

export const name = "records.get";
export const access = "read";
export const config = {
  title: "Get record",
  description: "Fetch one record by id, including full text and meta.",
  inputSchema: { id: z.string().min(1).describe("Record id, e.g. rec_0001.") },
};

export function run({ id }, { records }) {
  const row = records.get(id);
  if (!row) throw new Error(`records.get: no record with id ${id}`);
  return { text: JSON.stringify(row, null, 2) };
}
