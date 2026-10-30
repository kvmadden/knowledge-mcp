// Shared test helpers. All data here is synthetic.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildRuntime, buildServer } from "../src/server.js";

// One synthetic value per pattern in config/deny-list.example.json.
export const SAMPLES = Object.freeze({
  "email-address": "jordan.sample@example.com",
  "us-phone-number": "555-010-0199",
  "us-ssn-format": "000-12-3456",
  "date-of-birth-label": "DOB: 01/02/1980",
  "record-number-label": "MRN 00012345",
  "payment-card-number": "4111 1111 1111 1111",
});

export function newRuntime(opts = {}) {
  return buildRuntime({ seedPath: null, ...opts });
}

export async function connect(runtime, opts) {
  const server = buildServer(runtime, opts);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, close: () => client.close() };
}

export function textOf(result) {
  return (result?.content ?? []).map((c) => c.text ?? "").join("\n");
}

/** Paths to every string leaf in a JSON-like value, e.g. ["tags", 0]. */
export function stringLeaves(value, at = []) {
  if (typeof value === "string") return [at];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringLeaves(v, [...at, i]));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => stringLeaves(v, [...at, k]));
  return [];
}

export function withLeaf(value, path, next) {
  const copy = structuredClone(value);
  let cursor = copy;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path[path.length - 1]] = next(cursor[path[path.length - 1]]);
  return copy;
}

export function dataOf(snapshot) {
  return JSON.stringify({ records: snapshot.records, files: snapshot.files });
}
