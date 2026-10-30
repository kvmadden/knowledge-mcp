import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createWebClient, keyRole, WEB_WRITE_METHODS } from "../web/client.js";
import { SAMPLES, stringLeaves, withLeaf } from "./_helpers.js";

const DENY_LIST = JSON.parse(readFileSync(new URL("../config/deny-list.example.json", import.meta.url), "utf8"));

function jwt(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.signature`;
}

// Fake supabase-js client: records every insert, never touches a network.
function fakeSupabase({ key = "sb_publishable_test", userId = "user-1" } = {}) {
  const inserts = [];
  return {
    supabaseKey: key,
    inserts,
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from(table) {
      return {
        insert(row) {
          inserts.push({ table, row });
          return { select: () => ({ single: async () => ({ data: { id: "row-1", ...row }, error: null }) }) };
        },
      };
    },
  };
}

const FIXTURES = {
  captureToInbox: { text: "Queue felt slow today.", sourceApp: "notes-app", suggestedBucket: "ideas", tags: ["ux"], linkUrl: "https://example.org/x" },
  writeDecision: { text: "Ship the smaller version first.", sourceApp: "notes-app", alternatives: ["Wait a month"], reversibility: "two-way", tags: ["scope"] },
  writeAnonymousSignal: { sourceApp: "notes-app", signal: "session-end", value: "ok" },
};

test("every write method returned by createWebClient has a fixture and is listed", () => {
  const client = createWebClient({ supabase: fakeSupabase(), denyList: DENY_LIST });
  assert.deepEqual(Object.keys(client).sort(), [...WEB_WRITE_METHODS].sort());
  assert.deepEqual(Object.keys(FIXTURES).sort(), [...WEB_WRITE_METHODS].sort());
});

for (const method of WEB_WRITE_METHODS) {
  test(`web ${method}: valid payload inserts once`, async () => {
    const sb = fakeSupabase();
    const client = createWebClient({ supabase: sb, denyList: DENY_LIST });
    const out = await client[method](FIXTURES[method]);
    assert.equal(out.blocked, undefined);
    assert.equal(sb.inserts.length, 1);
    assert.equal(sb.inserts[0].row.owner_id, "user-1");
  });

  test(`web ${method}: a deny-listed value in any field never reaches insert`, async () => {
    let screened = 0;
    for (const leaf of stringLeaves(FIXTURES[method])) {
      for (const sample of Object.values(SAMPLES)) {
        for (const plant of [() => sample, (old) => `${old} ${sample}`]) {
          const sb = fakeSupabase();
          const client = createWebClient({ supabase: sb, denyList: DENY_LIST });
          const out = await client[method](withLeaf(FIXTURES[method], leaf, plant));
          assert.equal(sb.inserts.length, 0, `${method} ${leaf.join(".")}`);
          assert.ok(out.blocked || out.error, "returns blocked or a validation error");
          if (out.blocked) {
            screened += 1;
            assert.ok(!JSON.stringify(out.blocked).includes(sample), "blocked result does not echo the value");
          }
        }
      }
    }
    assert.ok(screened > 0, "at least one case was stopped by the screening gate");
  });
}

test("keyRole classifies keys without network access", () => {
  assert.equal(keyRole("sb_secret_abc"), "secret");
  assert.equal(keyRole("sb_publishable_abc"), "publishable");
  assert.equal(keyRole(jwt({ role: "service_role" })), "service_role");
  assert.equal(keyRole(jwt({ role: "anon" })), "anon");
  assert.equal(keyRole("not-a-key"), "unknown");
  assert.equal(keyRole(undefined), "unknown");
});

test("refuses service-role, secret and unreadable keys", () => {
  for (const key of ["sb_secret_abc", jwt({ role: "service_role" }), "opaque", null, jwt({})]) {
    assert.throws(() => createWebClient({ supabase: fakeSupabase({ key }), denyList: DENY_LIST }), /refusing/);
  }
  assert.doesNotThrow(() => createWebClient({ supabase: fakeSupabase({ key: jwt({ role: "anon" }) }), denyList: DENY_LIST }));
});

test("refuses to build without a usable deny-list", () => {
  for (const denyList of [undefined, [], { patterns: [] }, [{ id: "x", pattern: "(" }]]) {
    assert.throws(() => createWebClient({ supabase: fakeSupabase(), denyList }));
  }
});

test("signed-out callers get an error and no insert", async () => {
  const sb = fakeSupabase({ userId: null });
  const client = createWebClient({ supabase: sb, denyList: DENY_LIST });
  const out = await client.captureToInbox(FIXTURES.captureToInbox);
  assert.match(out.error.message, /not signed in/);
  assert.equal(sb.inserts.length, 0);
});

test("web client imports only the shared screening module", () => {
  const src = readFileSync(new URL("../web/client.js", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["../src/screening/screen.js"]);
  assert.ok(!/service_role_key|SERVICE_ROLE_KEY/i.test(src), "no service-role key handling in browser code");
});
