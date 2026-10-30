// Node-only loader for the deny-list file. Kept apart from screen.js so the
// screening function itself stays importable in a browser.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createGate } from "./screen.js";

export const EXAMPLE_DENY_LIST_PATH = fileURLToPath(
  new URL("../../config/deny-list.example.json", import.meta.url),
);

/** Read, parse and compile a deny-list file. Throws on any problem. */
export function loadGate(filePath = EXAMPLE_DENY_LIST_PATH) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`deny-list not readable at ${filePath}`, { cause: error });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`deny-list at ${filePath} is not valid JSON`, { cause: error });
  }
  return createGate(parsed);
}
