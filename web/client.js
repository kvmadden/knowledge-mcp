// web/client.js: browser write client.
//
// Writes rows to a Supabase-style table through a client the app already
// created with a publishable (anon) key and the signed-in user's session.
// Plain ESM with no dependencies; it does not import supabase-js and accepts
// any object with the same `from().insert().select().single()` and
// `auth.getUser()` shape.
//
// Two rules hold for every method:
//   1. Every row is screened in full by the same gate the MCP server uses
//      (src/screening/screen.js) immediately before insert. On a match the
//      method returns { blocked } and the insert is never called.
//   2. The client refuses to construct around a service-role or secret key,
//      or around a key whose role it cannot read. Browser code never holds a
//      key that bypasses row-level security.
//
// This check runs in the browser, so a user who edits the page can skip it.
// It keeps honest apps from sending matching content; enforcing the same
// rule for every browser write needs the identical check on the database
// side, which is outside this repo.

import { createGate } from "../src/screening/screen.js";

const SOURCE_APP_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SIGNAL_RE = /^[a-z][a-z0-9-]{0,63}$/;
const TOKEN_RE = /^[a-z0-9_-]{1,32}$/i;
const ALLOWED_ROLES = new Set(["anon", "authenticated", "publishable"]);

function decodeBase64Url(part) {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return atob(b64);
}

/** Classify a Supabase API key without sending it anywhere. */
export function keyRole(key) {
  if (typeof key !== "string" || key.length === 0) return "unknown";
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable";
  const parts = key.split(".");
  if (parts.length !== 3) return "unknown";
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    return typeof payload.role === "string" ? payload.role : "unknown";
  } catch {
    return "unknown";
  }
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim().slice(0, 64)))];
}

function invalid(message) {
  return { error: new Error(message) };
}

/**
 * @param {object} opts
 * @param {object} opts.supabase   supabase-js client (publishable key + user session)
 * @param {object|Array} opts.denyList  same JSON shape as config/deny-list.example.json
 * @param {string} [opts.table]    defaults to "records"
 */
export function createWebClient({ supabase, denyList, table = "records" } = {}) {
  if (!supabase || typeof supabase.from !== "function" || typeof supabase.auth?.getUser !== "function") {
    throw new TypeError("createWebClient: supabase must be a supabase-js style client");
  }
  const role = keyRole(supabase.supabaseKey);
  if (!ALLOWED_ROLES.has(role)) {
    throw new Error(`createWebClient: refusing a client whose key role is "${role}"; use a publishable (anon) key`);
  }
  const gate = createGate(denyList);

  // The single insert path. Every method below ends here.
  async function insertScreened(row, selectCols) {
    const user = await supabase.auth.getUser();
    const userId = user?.data?.user?.id;
    if (!userId) return invalid("not signed in");
    const full = { ...row, owner_id: userId };
    const verdict = gate.screen(full);
    if (!verdict.ok) return { blocked: { violations: verdict.violations } };
    const { data, error } = await supabase.from(table).insert(full).select(selectCols).single();
    return { data, error };
  }

  async function captureToInbox({ text, sourceApp, suggestedBucket, tags, linkUrl } = {}) {
    if (typeof text !== "string" || !text.trim()) return invalid("captureToInbox: text is required");
    if (text.length > 8000) return invalid("captureToInbox: text exceeds 8000 characters");
    if (!SOURCE_APP_RE.test(sourceApp ?? "")) return invalid("captureToInbox: sourceApp must be lowercase kebab-case");
    return insertScreened(
      {
        text: text.trim(),
        source_app: sourceApp,
        bucket: suggestedBucket || null,
        status: "inbox",
        tags: cleanTags([...(tags ?? []), "capture"]),
        meta: {
          type: "note",
          captured_via: "knowledge-mcp/web",
          ...(suggestedBucket && { suggested_bucket: suggestedBucket }),
          ...(typeof linkUrl === "string" && linkUrl && { link_url: linkUrl }),
        },
      },
      "id, text, bucket, source_app, status, tags, meta, created_at",
    );
  }

  async function writeDecision({ text, sourceApp, alternatives, reversibility, tags } = {}) {
    if (typeof text !== "string" || !text.trim()) return invalid("writeDecision: text is required");
    if (text.length > 8000) return invalid("writeDecision: text exceeds 8000 characters");
    if (!SOURCE_APP_RE.test(sourceApp ?? "")) return invalid("writeDecision: sourceApp must be lowercase kebab-case");
    if (reversibility && !["one-way", "two-way"].includes(reversibility)) {
      return invalid('writeDecision: reversibility must be "one-way" or "two-way"');
    }
    const alts = (Array.isArray(alternatives) ? alternatives : []).filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim());
    return insertScreened(
      {
        text: text.trim(),
        source_app: sourceApp,
        bucket: null,
        status: "filed",
        tags: cleanTags([...(tags ?? []), "decision"]),
        meta: { type: "decision", captured_via: "knowledge-mcp/web", decision: { alternatives: alts, reversibility: reversibility || null } },
      },
      "id, text, status, tags, meta, created_at",
    );
  }

  async function writeAnonymousSignal({ sourceApp, signal, value } = {}) {
    if (!SOURCE_APP_RE.test(sourceApp ?? "")) return invalid("writeAnonymousSignal: sourceApp must be lowercase kebab-case");
    if (typeof signal !== "string" || !SIGNAL_RE.test(signal)) return invalid("writeAnonymousSignal: signal must be lowercase kebab-case");
    let valuePayload;
    if (typeof value === "number" && Number.isFinite(value)) valuePayload = { numeric: value };
    else if (typeof value === "string" && TOKEN_RE.test(value)) valuePayload = { token: value };
    else return invalid("writeAnonymousSignal: value must be a finite number or a short token");
    // Constrained shape, and still screened like everything else.
    return insertScreened(
      {
        text: `${sourceApp}:${signal}`,
        source_app: sourceApp,
        bucket: null,
        status: "filed",
        tags: ["signal"],
        meta: { type: "note", captured_via: "knowledge-mcp/web", signal, ...valuePayload },
      },
      "id, text, status, tags, meta, created_at",
    );
  }

  return Object.freeze({ captureToInbox, writeDecision, writeAnonymousSignal });
}

/** Names of the write methods on a client from createWebClient. Tests enumerate this. */
export const WEB_WRITE_METHODS = Object.freeze(["captureToInbox", "writeDecision", "writeAnonymousSignal"]);
