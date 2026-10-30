// memory-store.js: the raw store. In-memory, with optional JSON-file persistence.
//
// Nothing outside src/store/ and the startup wiring in src/server.js may hold
// a reference to this object. Tools receive the guarded store instead
// (guarded-store.js), which screens every argument of every write method.
//
// Every method is classified as a read or a write in READ_METHODS and
// WRITE_METHODS below. The guarded store refuses to wrap a store that has an
// unclassified method, so adding a write here without classifying it stops
// the server from starting.

import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { matchesQuery } from "../lib/search.js";

export const READ_METHODS = Object.freeze([
  "getRecord",
  "listRecords",
  "searchRecords",
  "getFile",
  "listFiles",
  "listAudit",
  "snapshot",
]);

export const WRITE_METHODS = Object.freeze([
  "insertRecord",
  "updateRecordMeta",
  "putFile",
  "deleteFiles",
  "moveFiles",
  "appendAudit",
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit, fallback = DEFAULT_LIMIT) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function emptyState() {
  return { nextRecord: 1, records: [], files: [], audit: [] };
}

export class MemoryStore {
  #state;
  #persistPath;
  #now;

  constructor({ persistPath = null, now = () => new Date().toISOString() } = {}) {
    this.#persistPath = persistPath;
    this.#now = now;
    this.#state = persistPath && existsSync(persistPath)
      ? JSON.parse(readFileSync(persistPath, "utf8"))
      : emptyState();
  }

  // ── reads ────────────────────────────────────────────────────────────

  getRecord(ownerId, id) {
    return clone(this.#state.records.find((r) => r.owner_id === ownerId && r.id === id)) ?? null;
  }

  listRecords(ownerId, { type, bucket, buckets, since, titledOnly, sourceApp, includeArchived = false, sortBy = "updated_at", limit } = {}) {
    let rows = this.#state.records.filter((r) => r.owner_id === ownerId);
    if (!includeArchived) rows = rows.filter((r) => r.status !== "archived");
    if (Array.isArray(buckets) && buckets.length) rows = rows.filter((r) => buckets.includes(r.bucket));
    else if (bucket) rows = rows.filter((r) => r.bucket === bucket);
    if (type) rows = rows.filter((r) => r.meta?.type === type);
    if (sourceApp) rows = rows.filter((r) => r.source_app === sourceApp);
    if (titledOnly) rows = rows.filter((r) => typeof r.meta?.title === "string");
    if (since) rows = rows.filter((r) => r[sortBy] >= since);
    rows = [...rows].sort((a, b) => (a[sortBy] < b[sortBy] ? 1 : a[sortBy] > b[sortBy] ? -1 : b.seq - a.seq));
    return clone(rows.slice(0, clampLimit(limit)));
  }

  searchRecords(ownerId, { query, limit, ...filter } = {}) {
    const rows = this.listRecords(ownerId, { ...filter, sortBy: "created_at", limit: MAX_LIMIT * 50 });
    return rows.filter((r) => matchesQuery(query, searchableText(r))).slice(0, clampLimit(limit, 25));
  }

  getFile(ownerId, filePath) {
    return clone(this.#state.files.find((f) => f.owner_id === ownerId && f.path === filePath)) ?? null;
  }

  listFiles(ownerId, prefix = "/") {
    return clone(
      this.#state.files
        .filter((f) => f.owner_id === ownerId && f.path.startsWith(prefix))
        .sort((a, b) => (a.path < b.path ? -1 : 1)),
    );
  }

  listAudit() {
    return clone(this.#state.audit);
  }

  snapshot() {
    return clone(this.#state);
  }

  // ── writes ───────────────────────────────────────────────────────────

  insertRecord(row) {
    const at = this.#now();
    const seq = this.#state.nextRecord;
    const record = {
      id: `rec_${String(seq).padStart(4, "0")}`,
      seq,
      owner_id: row.owner_id,
      text: row.text,
      bucket: row.bucket ?? null,
      source_app: row.source_app,
      status: row.status ?? "inbox",
      tags: [...(row.tags ?? [])],
      meta: clone(row.meta ?? {}),
      created_at: at,
      updated_at: at,
    };
    this.#state.nextRecord += 1;
    this.#state.records.push(record);
    this.#persist();
    return clone(record);
  }

  /** Shallow-merge into meta. A patch value of null removes that key. */
  updateRecordMeta(ownerId, id, patch) {
    const record = this.#state.records.find((r) => r.owner_id === ownerId && r.id === id);
    if (!record) return null;
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete record.meta[key];
      else record.meta[key] = clone(value);
    }
    record.updated_at = this.#now();
    this.#persist();
    return clone(record);
  }

  putFile(ownerId, filePath, content, version) {
    const at = this.#now();
    const existing = this.#state.files.find((f) => f.owner_id === ownerId && f.path === filePath);
    if (existing) {
      existing.content = content;
      existing.version = version;
      existing.size_bytes = byteLength(content);
      existing.updated_at = at;
    } else {
      this.#state.files.push({
        owner_id: ownerId,
        path: filePath,
        content,
        version,
        size_bytes: byteLength(content),
        created_at: at,
        updated_at: at,
      });
    }
    this.#persist();
    return true;
  }

  deleteFiles(ownerId, paths) {
    const drop = new Set(paths);
    const before = this.#state.files.length;
    this.#state.files = this.#state.files.filter((f) => !(f.owner_id === ownerId && drop.has(f.path)));
    this.#persist();
    return before - this.#state.files.length;
  }

  /** Apply all moves or none. Fails if a source is missing or a target exists. */
  moveFiles(ownerId, moves) {
    const files = this.#state.files.filter((f) => f.owner_id === ownerId);
    const byPath = new Map(files.map((f) => [f.path, f]));
    const sources = new Set(moves.map(([from]) => from));
    for (const [from, to] of moves) {
      if (!byPath.has(from)) throw new Error(`move source missing: ${from}`);
      if (byPath.has(to) && !sources.has(to)) throw new Error(`move target exists: ${to}`);
    }
    const at = this.#now();
    for (const [from, to] of moves) {
      const file = byPath.get(from);
      file.path = to;
      file.updated_at = at;
    }
    this.#persist();
    return moves.length;
  }

  appendAudit(entry) {
    this.#state.audit.push({ ...clone(entry), at: this.#now() });
    this.#persist();
    return true;
  }

  #persist() {
    if (!this.#persistPath) return;
    mkdirSync(path.dirname(this.#persistPath), { recursive: true });
    const tmp = `${this.#persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.#state, null, 2));
    renameSync(tmp, this.#persistPath);
  }
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function searchableText(record) {
  return [record.text, record.meta?.title, record.meta?.summary, ...(record.tags ?? [])]
    .filter((v) => typeof v === "string")
    .join("\n");
}
