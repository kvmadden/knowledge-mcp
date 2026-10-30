// Demo: start the server in-process on the synthetic seed, connect an MCP
// client over an in-memory transport, and show one accepted and one refused
// write per write tool. Prints a table; touches no network and no disk.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildRuntime, buildServer, DEFAULT_SEED_PATH } from "../src/server.js";

const runtime = buildRuntime({ seedPath: DEFAULT_SEED_PATH });
const server = buildServer(runtime);
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "demo", version: "1.0.0" });
await Promise.all([server.connect(b), client.connect(a)]);

const fake = "pat.example@example.com";
const calls = [
  ["records.create", { text: "Weekly sync notes", bucket: "projects" }, { text: `Weekly sync notes, contact ${fake}` }],
  ["decisions.log", { title: "Adopt the shorter template" }, { title: "Adopt the shorter template", context: `Owner: ${fake}` }],
  ["inbox.capture", { text: "Try a smaller index" }, { text: "Try a smaller index", link_url: `mailto:${fake}` }],
  ["inbox.capture_quick", { text: "Call back about the demo" }, { text: "Call back at 555-010-0142" }],
  ["memory.create", { path: "/memories/demo/a.md", file_text: "draft" }, { path: "/memories/demo/b.md", file_text: "MRN 00098765" }],
  ["memory.str_replace", { path: "/memories/demo/a.md", old_str: "draft", new_str: "final" }, { path: "/memories/demo/a.md", old_str: "final", new_str: "DOB: 03/04/1975" }],
  ["memory.rename", { old_path: "/memories/demo/a.md", new_path: "/memories/demo/c.md" }, { old_path: "/memories/demo/c.md", new_path: `/memories/demo/${fake}.md` }],
];

const rows = [];
for (const [name, good, bad] of calls) {
  const ok = await client.callTool({ name, arguments: good });
  const refused = await client.callTool({ name, arguments: bad });
  rows.push({ tool: name, benign: ok.isError ? "error" : "written", planted: refused.isError ? refused.content[0].text.replace(/^.*?rejected/, "rejected") : "WRITTEN" });
}
console.table(rows);

const persisted = JSON.stringify(runtime.snapshot());
console.log(`planted values found in store after demo: ${["pat.example", "555-010-0142", "00098765", "1975"].filter((v) => persisted.includes(v)).length}`);
console.log(`screen_blocked audit entries: ${runtime.snapshot().audit.filter((e) => e.op === "screen_blocked").length}`);
await client.close();
