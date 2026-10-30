// Record operations used by the records.*, decisions.* and inbox.* tools.
// Writes go through the guarded store passed in `store`; this module never
// sees the raw store, so it has no way to write without screening.

import { isKnownBucket } from "./buckets.js";

export const RECORD_TYPES = Object.freeze(["note", "decision", "rule", "reference", "person", "task"]);
export const SERVER_SOURCE_APP = "knowledge-mcp";

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))].map((t) => t.slice(0, 64));
}

function requireBucket(bucket, label) {
  if (bucket == null || bucket === "") return null;
  if (!isKnownBucket(bucket)) throw new Error(`${label}: unknown bucket "${bucket}". Use inbox.buckets to list valid ids.`);
  return bucket;
}

export function toSummary(row) {
  if (!row) return null;
  const meta = row.meta ?? {};
  return {
    id: row.id,
    type: meta.type ?? "note",
    bucket: row.bucket ?? null,
    title: meta.title ?? null,
    summary: meta.summary ?? null,
    text: typeof row.text === "string" ? row.text.slice(0, 500) : "",
    pinned: Boolean(meta.pinned),
    tags: row.tags ?? [],
    sourceApp: row.source_app ?? null,
    status: row.status ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function toDetail(row) {
  if (!row) return null;
  return { ...toSummary(row), text: row.text ?? "", meta: row.meta ?? {} };
}

export function createRecords({ store, ownerId }) {
  return {
    list(filter = {}) {
      return store.listRecords(ownerId, filter).map(toSummary);
    },

    get(id) {
      return toDetail(store.getRecord(ownerId, id));
    },

    recent({ bucket, since, limit = 25 } = {}) {
      return store.listRecords(ownerId, { bucket, since, limit, sortBy: "created_at", includeArchived: true }).map(toSummary);
    },

    search({ query, bucket, sourceApp, since, limit = 25 } = {}) {
      if (typeof query !== "string" || !query.trim()) throw new Error("inbox.search: query must be a non-empty string");
      return store.searchRecords(ownerId, { query, bucket, sourceApp, since, limit }).map(toSummary);
    },

    recentDecisions(limit = 10) {
      return store.listRecords(ownerId, { type: "decision", limit }).map(toSummary);
    },

    create({ text, type = "note", bucket, title, summary, tags = [] }) {
      if (typeof text !== "string" || !text.trim()) throw new Error("records.create: text is required");
      if (!RECORD_TYPES.includes(type)) throw new Error(`records.create: type must be one of ${RECORD_TYPES.join(", ")}`);
      const titled = typeof title === "string" && title.trim().length > 0;
      const row = store.insertRecord({
        owner_id: ownerId,
        text,
        bucket: requireBucket(bucket, "records.create"),
        source_app: SERVER_SOURCE_APP,
        status: titled ? "filed" : "inbox",
        tags: cleanTags(tags),
        meta: {
          type,
          ...(titled && { title: title.trim(), summary: summary ? String(summary).trim() : null }),
        },
      });
      return toSummary(row);
    },

    pin({ id, pinned = true }) {
      if (typeof id !== "string" || !id) throw new Error("records.pin: id is required");
      const patch = pinned ? { pinned: true, pinnedAt: new Date().toISOString() } : { pinned: null, pinnedAt: null };
      const row = store.updateRecordMeta(ownerId, id, patch);
      if (!row) throw new Error(`records.pin: no record with id ${id}`);
      return { id: row.id, pinned: Boolean(row.meta.pinned), pinnedAt: row.meta.pinnedAt ?? null };
    },

    logDecision({ title, summary, context, bucket }) {
      if (typeof title !== "string" || !title.trim()) throw new Error("decisions.log: title is required");
      const t = title.trim();
      const body = context ? `${t}\n\n${String(context).trim()}` : t;
      const row = store.insertRecord({
        owner_id: ownerId,
        text: body,
        bucket: requireBucket(bucket, "decisions.log"),
        source_app: SERVER_SOURCE_APP,
        status: "filed",
        tags: ["decision"],
        meta: {
          type: "decision",
          title: t,
          summary: summary ? String(summary).trim() : null,
          decision: { loggedAt: new Date().toISOString() },
        },
      });
      return toSummary(row);
    },

    capture({ text, source_app, suggested_bucket, tags = [], link_url }) {
      if (typeof text !== "string" || !text.trim()) throw new Error("inbox.capture: text is required");
      const bucket = requireBucket(suggested_bucket, "inbox.capture");
      const row = store.insertRecord({
        owner_id: ownerId,
        text,
        bucket,
        source_app: source_app || SERVER_SOURCE_APP,
        status: "inbox",
        tags: cleanTags([...tags, "capture"]),
        meta: {
          type: "note",
          ...(bucket && { suggested_bucket: bucket }),
          ...(link_url && { link_url: String(link_url) }),
        },
      });
      return toSummary(row);
    },
  };
}
