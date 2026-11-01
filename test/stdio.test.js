// End to end over the real stdio transport: spawn the server the way an MCP
// host would, list tools, write, and confirm a matching write is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { SAMPLES, textOf } from "./_helpers.js";

const ENTRY = fileURLToPath(new URL("../src/index.js", import.meta.url));

test("stdio server: list, capture, refuse, search", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY],
    env: { PATH: process.env.PATH },
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 18);

    const ok = await client.callTool({ name: "inbox.capture", arguments: { text: "Remember the stdio test", suggested_bucket: "ideas" } });
    assert.ok(!ok.isError, textOf(ok));

    const refused = await client.callTool({ name: "inbox.capture", arguments: { text: `Reach me at ${SAMPLES["email-address"]}` } });
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), /rejected by screening: field "text" matched "email-address"/);
    assert.ok(!textOf(refused).includes("jordan"), "error does not echo the value");

    const found = await client.callTool({ name: "inbox.search", arguments: { query: "stdio" } });
    assert.match(textOf(found), /Found 1 match/);
    const none = await client.callTool({ name: "inbox.search", arguments: { query: "reach" } });
    assert.match(textOf(none), /No rows matched/);
  } finally {
    await client.close();
  }
});
