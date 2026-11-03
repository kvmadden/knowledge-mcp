// Path validation for the memory-file tools. Every path must live under
// /memories, in canonical form, with no traversal or control characters.

export class MemoryPathError extends Error {
  constructor(message) {
    super(message);
    this.name = "MemoryPathError";
  }
}

export const ROOT = "/memories";

const TRAVERSAL = [/\.\.\//, /\.\.\\/, /\/\.\.($|\/)/, /%2e%2e/i, /%252e%252e/i, /\\u002e\\u002e/i];
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * @returns {{ canonical: string, subPath: string, isRoot: boolean }}
 *   subPath is the part after /memories ("/notes/a.md"), "" for the root.
 */
export function validateMemoryPath(rawInput, { allowRoot = true } = {}) {
  if (typeof rawInput !== "string" || rawInput.length === 0) throw new MemoryPathError("path must be a non-empty string");
  // One spelling per path: composed and decomposed forms of the same name are the same file.
  const input = rawInput.normalize("NFC");
  if (input.length > 1024) throw new MemoryPathError("path exceeds 1024 characters");
  if (CONTROL_CHARS.test(input)) throw new MemoryPathError("path contains control characters");
  for (const re of TRAVERSAL) {
    if (re.test(input)) throw new MemoryPathError("path contains a traversal sequence");
  }
  if (input === ROOT || input === `${ROOT}/`) {
    if (!allowRoot) throw new MemoryPathError("operation needs a file path, not the /memories root");
    return { canonical: ROOT, subPath: "", isRoot: true };
  }
  if (!input.startsWith(`${ROOT}/`)) throw new MemoryPathError(`path must start with ${ROOT}/`);
  const subPath = input.slice(ROOT.length);
  if (subPath.includes("//")) throw new MemoryPathError("path contains an empty segment (//)");
  if (subPath.endsWith("/")) throw new MemoryPathError("path must not end with /");
  for (const segment of subPath.split("/").filter(Boolean)) {
    if (segment.startsWith(".")) throw new MemoryPathError("a path segment may not start with a dot");
  }
  return { canonical: ROOT + subPath, subPath, isRoot: false };
}
