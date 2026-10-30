import test from "node:test";
import assert from "node:assert/strict";

import { newRuntime, connect, textOf } from "./_helpers.js";
import { matchesQuery, parseQuery } from "../src/lib/search.js";
import { suggestBucket } from "../src/lib/route-suggest.js";
import { BUCKETS } from "../src/lib/buckets.js";

test("create, get, list and pin", () => {
  const { ctx } = newRuntime();
  const a = ctx.records.create({ text: "first", bucket: "projects", tags: ["x", "x", " y "] });
  const b = ctx.records.create({ text: "second", title: "Filed one", summary: "short" });
  assert.equal(a.id, "rec_0001");
  assert.deepEqual(a.tags, ["x", "y"]);
  assert.equal(a.status, "inbox");
  assert.equal(b.status, "filed");
  assert.equal(ctx.records.get("rec_0002").meta.title, "Filed one");
  assert.deepEqual(ctx.records.list({ titledOnly: true }).map((r) => r.id), ["rec_0002"]);
  assert.deepEqual(ctx.records.list({ bucket: "projects" }).map((r) => r.id), ["rec_0001"]);
  assert.equal(ctx.records.pin({ id: "rec_0001" }).pinned, true);
  assert.equal(ctx.records.pin({ id: "rec_0001", pinned: false }).pinned, false);
  assert.throws(() => ctx.records.pin({ id: "rec_9999" }), /no record/);
});

test("unknown bucket ids are rejected", () => {
  const { ctx } = newRuntime();
  assert.throws(() => ctx.records.create({ text: "x", bucket: "nope" }), /unknown bucket/);
  assert.throws(() => ctx.records.capture({ text: "x", suggested_bucket: "nope" }), /unknown bucket/);
  assert.throws(() => ctx.records.logDecision({ title: "x", bucket: "nope" }), /unknown bucket/);
});

test("decisions and captures", () => {
  const { ctx } = newRuntime();
  const d = ctx.records.logDecision({ title: "Pick plain text", summary: "for now", context: "Alternatives: JSON." });
  assert.equal(d.type, "decision");
  assert.match(ctx.records.get(d.id).text, /Pick plain text\n\nAlternatives/);
  const c = ctx.records.capture({ text: "idea", suggested_bucket: "ideas", link_url: "https://example.org" });
  assert.deepEqual(c.tags, ["capture"]);
  assert.equal(ctx.records.get(c.id).meta.link_url, "https://example.org");
  assert.deepEqual(ctx.records.recentDecisions().map((r) => r.id), [d.id]);
});

test("search syntax: words, phrases, exclusions", () => {
  assert.deepEqual(parseQuery('cold "warm up" -index'), { include: ["cold", "warm up"], exclude: ["index"] });
  assert.equal(matchesQuery("cold start", "Cold START notes"), true);
  assert.equal(matchesQuery('"start cold"', "cold start"), false);
  assert.equal(matchesQuery("cold -start", "cold start"), false);
  assert.equal(matchesQuery("", "anything"), false);
});

test("search runs over seeded synthetic data through the MCP client", async () => {
  const runtime = newRuntime({ seedPath: new URL("../data/seed.json", import.meta.url).pathname });
  const { client, close } = await connect(runtime);
  const hit = await client.callTool({ name: "inbox.search", arguments: { query: "benchmark" } });
  const miss = await client.callTool({ name: "inbox.search", arguments: { query: "benchmark -restart" } });
  await close();
  assert.match(textOf(hit), /Found 1 match/);
  assert.match(textOf(miss), /No rows matched/);
});

test("route suggestion is labeled as a heuristic and capped", () => {
  const s = suggestBucket("benchmark results from the research experiment", BUCKETS);
  assert.equal(s.bucket_id, "projects-research");
  assert.equal(s.source, "keyword-heuristic");
  assert.ok(s.confidence <= 0.49);
  assert.equal(suggestBucket("zzz qqq", BUCKETS).bucket_id, "unsorted");
});
