// run.mjs: scores the fresh blind set once, next to its baselines, as
// docs/evaluation/fresh-set-spec.md sections 5 and 6 describe.
//
//   node eval/blind/run.mjs [--cases eval/blind-2026-11/cases.json] [--out <dir>]
//       [--subjects no-gate,gate-2e39dbf,gate-head,injection-classifier,presidio]
//       [--before-root <checkout of 2e39dbf>] [--python <venv python>] [--label <name>]
//       [--no-lock-check]
//   node eval/blind/run.mjs --prepare-before <path>   (makes the 2e39dbf worktree)
//
// What it does, in order:
//   1. Checks cases.json against cases.sha256 and refuses a mismatch. Unless
//      --no-lock-check is given, also requires both files to be committed and
//      unchanged, and names the commit that last changed them.
//   2. Checks the schema of section 2 and refuses a file with any problem.
//   3. Runs every case, setup calls first, in a fresh runtime behind a real
//      MCP client and server, once per subject, and scores the judged call as
//      stored, held, blocked or invalid. Invalid outcomes are listed for
//      investigation and never count as correct.
//   4. Writes report.json and report.md to the output directory.
//
// The two off-the-shelf detectors run offline in Python (baselines/score.py)
// before any case runs, in one batch over every text the set's writes would
// store. A write they flag counts as blocked. Writes they pass go to the
// tools with no gate. They read the free-text content of a write, not its
// identifiers, paths or labels, and for an edit the whole file as it would
// be after the edit, so a value assembled across edits is in their view as
// it is in the gate's.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { isCorrect, itemKey, metricsFor, renderMarkdown, scoreCall, sha256, verifyHash, validateSet } from './lib.mjs'

export const REPO = fileURLToPath(new URL('../..', import.meta.url))
export const BEFORE_COMMIT = '2e39dbf'
export const DEFAULT_CASES = path.join(REPO, 'eval/blind-2026-11/cases.json')
export const DEFAULT_PYTHON = path.join(homedir(), 'dev/toolchains/blind-baselines/bin/python')
export const ALL_SUBJECTS = ['no-gate', 'gate-2e39dbf', 'gate-head', 'injection-classifier', 'presidio']

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const tryGit = (cwd, ...args) => {
  try {
    return git(cwd, ...args)
  } catch {
    return null
  }
}

const textOf = (result) => (result?.content ?? []).map((c) => c.text ?? '').join('\n')
const dataOf = (snapshot) => JSON.stringify({ records: snapshot.records, files: snapshot.files })

function stringLeaves(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringLeaves(v, out)
  return out
}

// The free-text arguments of each write tool. Ids, paths, buckets, labels
// and links are left out: short identifiers make both detectors misfire (the
// classifier scores "rec_0001" as an injection, Presidio reads "notes.md" as
// a URL), and a deployment would screen what the agent writes, not names.
export const CONTENT_FIELDS = Object.freeze({
  'records.create': ['text', 'title', 'summary', 'tags'],
  'decisions.log': ['title', 'summary', 'context'],
  'inbox.capture': ['text', 'tags'],
  'inbox.capture_quick': ['text'],
  'records.pin': [],
  'memory.create': ['file_text'],
  'memory.str_replace': [],
  'memory.insert': [],
  'memory.delete': [],
  'memory.rename': [],
})

// The file an edit would leave, computed the way the memory tools do. Null
// when the tool would refuse the edit, in which case nothing is stored.
export function editedFile(tool, args, files) {
  if (typeof args.path !== 'string') return null
  const sub = args.path.normalize('NFC').replace(/^\/memories(?=\/)/, '')
  const file = files.find((f) => f.path === sub)
  if (!file) return null
  if (tool === 'memory.str_replace') {
    if (typeof args.old_str !== 'string' || typeof args.new_str !== 'string' || !args.old_str) return null
    const first = file.content.indexOf(args.old_str)
    if (first < 0 || file.content.indexOf(args.old_str, first + args.old_str.length) >= 0) return null
    return file.content.slice(0, first) + args.new_str + file.content.slice(first + args.old_str.length)
  }
  if (typeof args.insert_text !== 'string' || !Number.isInteger(args.insert_line)) return null
  const lines = file.content.split('\n')
  if (args.insert_line < 0 || args.insert_line > lines.length) return null
  const added = (args.insert_text.endsWith('\n') ? args.insert_text.slice(0, -1) : args.insert_text).split('\n')
  return [...lines.slice(0, args.insert_line), ...added, ...lines.slice(args.insert_line)].join('\n')
}

/** What a detector reads for one write call, given the files stored before it. */
export function detectorTexts(tool, args, files) {
  if (tool === 'memory.str_replace' || tool === 'memory.insert') {
    const after = editedFile(tool, args, files)
    return after === null ? [] : [after]
  }
  const out = []
  for (const field of CONTENT_FIELDS[tool] ?? []) stringLeaves(args[field], out)
  return out
}

// ── loading and locking ─────────────────────────────────────────────────

/**
 * Read and check a set. Throws on a hash mismatch, a schema problem or, when
 * requireLock is set, a set that is not committed and unchanged.
 */
export function loadSet(casesPath, { requireLock = true } = {}) {
  const dir = path.dirname(casesPath)
  const shaPath = path.join(dir, 'cases.sha256')
  if (!existsSync(casesPath)) throw new Error(`no set at ${casesPath}: the blind set is not committed yet`)
  const bytes = readFileSync(casesPath)
  const shaText = existsSync(shaPath) ? readFileSync(shaPath, 'utf8') : ''
  const hash = verifyHash(bytes, shaText, path.basename(casesPath))
  let lock = { commit: null, note: 'not checked, run with --no-lock-check' }
  if (requireLock) {
    const top = tryGit(dir, 'rev-parse', '--show-toplevel')
    if (!top) throw new Error('the set is not in a git repository, so its lock commit cannot be named')
    // Git reports the real path of the repository, so compare real paths.
    const realCases = realpathSync(casesPath)
    const realSha = realpathSync(shaPath)
    for (const file of [realCases, realSha]) {
      const rel = path.relative(top, file)
      if (!tryGit(top, 'ls-files', '--error-unmatch', rel)) throw new Error(`${rel} is not committed, so the set is not locked`)
      if (tryGit(top, 'status', '--porcelain', '--', rel)) throw new Error(`${rel} has uncommitted changes, so the set is not the locked one`)
    }
    const casesCommit = git(top, 'log', '-1', '--format=%H', '--', path.relative(top, realCases))
    const shaCommit = git(top, 'log', '-1', '--format=%H', '--', path.relative(top, realSha))
    if (casesCommit !== shaCommit) throw new Error(`cases.json was last changed in ${casesCommit} and cases.sha256 in ${shaCommit}. Section 5 locks them in one commit.`)
    lock = { commit: casesCommit, note: 'cases.json and cases.sha256 last changed together in this commit' }
  }
  let set
  try {
    set = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`cases.json is not valid JSON: ${error.message}`)
  }
  const problems = validateSet(set)
  if (problems.length) throw new Error(`cases.json does not match the schema of section 2:\n- ${problems.join('\n- ')}`)
  return { set, hash, lock, path: casesPath }
}

// ── subjects ────────────────────────────────────────────────────────────

async function importRoot(root) {
  return import(pathToFileURL(path.join(root, 'src/server.js')).href)
}

// The tools of a checkout wired to its raw store: no screening at all. Tool
// argument checks (paths, URLs, buckets) still apply.
async function unscreenedFactory(root) {
  const server = await importRoot(root)
  const { MemoryStore } = await import(pathToFileURL(path.join(root, 'src/store/memory-store.js')).href)
  const { createRecords } = await import(pathToFileURL(path.join(root, 'src/lib/records.js')).href)
  const { createMemoryFiles } = await import(pathToFileURL(path.join(root, 'src/lib/memory-files.js')).href)
  const { BUCKETS, DEFAULT_BUCKET } = await import(pathToFileURL(path.join(root, 'src/lib/buckets.js')).href)
  return {
    tools: server.TOOLS,
    fresh() {
      const raw = new MemoryStore()
      const ctx = Object.freeze({
        records: createRecords({ store: raw, ownerId: 'local-owner' }),
        memory: createMemoryFiles({ store: raw, ownerId: 'local-owner' }),
        buckets: BUCKETS,
        defaultBucket: DEFAULT_BUCKET,
      })
      const runtime = { ctx, snapshot: () => raw.snapshot() }
      return { runtime, server: server.buildServer(runtime), holds: undefined }
    },
  }
}

async function gateFactory(root) {
  const server = await importRoot(root)
  return {
    tools: server.TOOLS,
    fresh() {
      const runtime = server.buildRuntime({ seedPath: null })
      return {
        runtime,
        server: server.buildServer(runtime),
        holds: runtime.review ? () => runtime.review.list().length : undefined,
        policy: runtime.gate?.policyId,
      }
    },
  }
}

// One batch of offline inference for every string the set writes. Returns
// a lookup from text to verdict, and the detector's versions.
function scoreStrings(detector, texts, { python, outDir, scores }) {
  if (scores) return scores
  if (!existsSync(python)) throw new Error(`no Python at ${python}. Run eval/blind/baselines/setup.sh first.`)
  const work = mkdtempSync(path.join(tmpdir(), 'blind-scores-'))
  try {
    const request = path.join(work, 'request.json')
    const response = path.join(outDir ?? work, `scores-${detector}.json`)
    writeFileSync(request, JSON.stringify({ texts: [...texts].map((text) => ({ key: sha256(text), text })) }))
    const run = spawnSync(python, ['-W', 'ignore', fileURLToPath(new URL('./baselines/score.py', import.meta.url)), '--detector', detector, '--in', request, '--out', response], {
      encoding: 'utf8',
      timeout: 2 * 60 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    })
    if (run.status !== 0) throw new Error(`the ${detector} scorer failed: ${(run.stderr || run.error?.message || '').trim().split('\n').slice(-3).join(' ')}`)
    return JSON.parse(readFileSync(response, 'utf8'))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function prefilterFrom(scored) {
  return (tool, args, files) => {
    let ms = 0
    const reasons = []
    let flagged = false
    for (const text of detectorTexts(tool, args, files)) {
      const verdict = scored.results[sha256(text)]
      if (!verdict) throw new Error('a string was not scored before the run')
      ms += verdict.ms ?? 0
      if (verdict.flagged) {
        flagged = true
        reasons.push(verdict.entities?.length ? verdict.entities.join('+') : `score ${verdict.score}`)
      }
    }
    return { flagged, ms, reasons }
  }
}

// The commit of this checkout, and whether anything differs from it apart
// from the set's own directory, where results are written.
function headVersion(excludeDir) {
  const commit = tryGit(REPO, 'rev-parse', 'HEAD')
  const skip = excludeDir ? path.relative(REPO, excludeDir).split(path.sep).join('/') : null
  const changes = (tryGit(REPO, 'status', '--porcelain') ?? '').split('\n').filter(Boolean)
    .map((line) => line.slice(3))
    .filter((file) => !(skip && !skip.startsWith('..') && (file === skip || file.startsWith(`${skip}/`))))
  return { commit, dirty: changes.length > 0 }
}

// Every text a detector would read in the set: each case is run on the tools
// with no gate, and before each write call the text it would store is
// collected. The detector run sees the same states, because a call it
// blocks ends the case.
async function collectDetectorTexts(set) {
  const plain = await unscreenedFactory(REPO)
  const writes = new Set(plain.tools.filter((t) => t.access === 'write').map((t) => t.name))
  const texts = new Set()
  for (const c of set.cases) {
    const fresh = plain.fresh()
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'blind-runner-collect', version: '1.0.0' })
    await Promise.all([fresh.server.connect(serverT), client.connect(clientT)])
    try {
      for (const [tool, args] of [...(c.setup ?? []), [c.tool, c.args]]) {
        if (writes.has(tool)) for (const t of detectorTexts(tool, args, fresh.runtime.snapshot().files)) texts.add(t)
        try {
          await client.callTool({ name: tool, arguments: args })
        } catch {
          // a refused call stores nothing
        }
      }
    } finally {
      await client.close()
    }
  }
  return texts
}

/**
 * Build the requested subjects. A subject that cannot run (no worktree of
 * 2e39dbf, no Python) is returned with `skipped` set, and the report says so.
 */
export async function buildSubjects(names, set, { beforeRoot, python = DEFAULT_PYTHON, outDir, detectorScores = {}, excludeDir } = {}) {
  const head = headVersion(excludeDir)
  const subjects = []
  let writeTexts = null
  const textsToScore = async () => (writeTexts ??= await collectDetectorTexts(set))
  for (const name of names) {
    const subject = { name, ran: false }
    try {
      if (name === 'no-gate') {
        Object.assign(subject, await unscreenedFactory(REPO), {
          description: 'The tools at this checkout wired to the raw store, with no screening. Tool argument checks still apply.',
          version: `${head.commit}${head.dirty ? ' (uncommitted changes)' : ''}`,
        })
      } else if (name === 'gate-head') {
        Object.assign(subject, await gateFactory(REPO), {
          description: 'The gate at this checkout, default deny-list.',
          version: `${head.commit}${head.dirty ? ' (uncommitted changes)' : ''}`,
        })
      } else if (name === 'gate-2e39dbf') {
        const root = beforeRoot ?? process.env.BLIND_BEFORE_ROOT
        if (!root) throw new Error('no checkout of 2e39dbf: pass --before-root, or make one with --prepare-before <path>')
        const at = tryGit(root, 'rev-parse', 'HEAD')
        const want = tryGit(REPO, 'rev-parse', `${BEFORE_COMMIT}^{commit}`) ?? BEFORE_COMMIT
        if (!at || !at.startsWith(BEFORE_COMMIT) || (want && at !== want)) throw new Error(`${root} is at ${at ?? 'no commit'}, not ${BEFORE_COMMIT}`)
        if (tryGit(root, 'status', '--porcelain', '--untracked-files=no')) throw new Error(`${root} has uncommitted changes`)
        Object.assign(subject, await gateFactory(root), {
          description: 'The gate at 2e39dbf, before the 2026-11-03 change, run from a git worktree of that commit, default deny-list.',
          version: at,
        })
      } else if (name === 'injection-classifier' || name === 'presidio') {
        const detector = name === 'presidio' ? 'presidio' : 'injection'
        const scored = scoreStrings(detector, await textsToScore(), { python, outDir, scores: detectorScores[detector] })
        Object.assign(subject, await unscreenedFactory(REPO), {
          prefilter: prefilterFrom(scored),
          description: detector === 'injection'
            ? `protectai/deberta-v3-base-prompt-injection-v2, local and offline, in front of the tools with no gate. A write is blocked when the injection probability of any text it stores reaches ${scored.threshold}.`
            : `Presidio Analyzer with its default English recognizers and spaCy model, offline, in front of the tools with no gate. A write is blocked when any entity of any type in the text it stores scores ${scored.threshold} or more.`,
          version: Object.entries(scored.versions).filter(([k]) => k !== 'recognizers' && k !== 'labels').map(([k, v]) => `${k} ${v}`).join(', '),
          detector: { threshold: scored.threshold, versions: scored.versions, networkAttemptsBlocked: scored.networkAttemptsBlocked, loadMs: scored.loadMs },
        })
      } else {
        throw new Error(`unknown subject ${name}`)
      }
      subject.toolNames = new Set(subject.tools.map((t) => t.name))
      subject.writeTools = new Set(subject.tools.filter((t) => t.access === 'write').map((t) => t.name))
      subject.ran = true
    } catch (error) {
      subject.skipped = error.message
    }
    subjects.push(subject)
  }
  return subjects
}

// ── running ─────────────────────────────────────────────────────────────

async function callOnce(subject, session, tool, args) {
  if (!subject.toolNames.has(tool)) return { outcome: 'invalid', reason: `${tool} is not a tool in this revision`, ms: null }
  const isWrite = subject.writeTools.has(tool)
  let extraMs = 0
  if (isWrite && subject.prefilter) {
    const verdict = subject.prefilter(tool, args, session.runtime.snapshot().files)
    if (verdict.flagged) return { outcome: 'blocked', ms: verdict.ms, flaggedBy: verdict.reasons }
    extraMs = verdict.ms
  }
  const before = dataOf(session.runtime.snapshot())
  const holdsBefore = session.holds?.()
  const started = performance.now()
  let result
  try {
    result = await session.client.callTool({ name: tool, arguments: args })
  } catch (error) {
    result = { isError: true, content: [{ type: 'text', text: `request failed: ${error.message}` }] }
  }
  const ms = performance.now() - started + extraMs
  const changed = dataOf(session.runtime.snapshot()) !== before
  const text = textOf(result)
  if (!isWrite) return result.isError ? { outcome: 'invalid', reason: `read failed: ${text.split('\n')[0]}`, ms } : { outcome: 'read', ms }
  const holdAdded = holdsBefore === undefined ? undefined : session.holds() > holdsBefore
  return { ...scoreCall({ changed, isError: Boolean(result.isError), text, holdAdded }), ms }
}

/** Run one case in a fresh runtime. Setup calls must apply, or the case is invalid. */
export async function runCase(subject, c) {
  const fresh = subject.fresh()
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'blind-runner', version: '1.0.0' })
  await Promise.all([fresh.server.connect(serverT), client.connect(clientT)])
  const session = { ...fresh, client }
  try {
    for (const [i, [tool, args]] of (c.setup ?? []).entries()) {
      const step = await callOnce(subject, session, tool, args)
      const applied = step.outcome === 'stored' || step.outcome === 'read'
      if (!applied) return { outcome: 'invalid', reason: `setup call ${i + 1} (${tool}) was ${step.outcome}${step.reason ? `: ${step.reason}` : ''}`, ms: null }
    }
    return await callOnce(subject, session, c.tool, c.args)
  } finally {
    await client.close()
  }
}

/**
 * Score a set on every subject. Returns the report object, which
 * renderMarkdown turns into the side-by-side page.
 */
export async function runEvaluation({ casesPath = DEFAULT_CASES, subjects: names = ALL_SUBJECTS, requireLock = true, label, beforeRoot, python, outDir, detectorScores } = {}) {
  const startedAt = new Date().toISOString()
  const head = headVersion(path.dirname(casesPath))
  const loaded = loadSet(casesPath, { requireLock })
  const subjects = await buildSubjects(names, loaded.set, { beforeRoot, python, outDir, detectorScores, excludeDir: path.dirname(casesPath) })
  const cases = loaded.set.cases.map((c) => ({ id: c.id, family: c.family, tier: c.tier, expected: c.expected, harm: c.harm, tool: c.tool, item: itemKey(c) }))
  const results = {}
  const metrics = {}
  for (const subject of subjects.filter((s) => s.ran)) {
    const rows = []
    for (const c of loaded.set.cases) {
      const scored = await runCase(subject, c)
      rows.push({
        id: c.id, family: c.family, tier: c.tier, expected: c.expected, harm: c.harm, item: itemKey(c),
        outcome: scored.outcome, reason: scored.reason, flaggedBy: scored.flaggedBy,
        correct: scored.outcome !== 'invalid' && isCorrect(c.expected, scored.outcome),
        ms: scored.ms === null || scored.ms === undefined ? null : Number(scored.ms.toFixed(3)),
      })
    }
    results[subject.name] = rows
    metrics[subject.name] = metricsFor(rows)
  }
  return {
    label: label ?? path.basename(path.dirname(casesPath)),
    headSubject: 'gate-head',
    set: {
      path: path.relative(REPO, casesPath) || casesPath,
      sha256: loaded.hash,
      lockCommit: loaded.lock.commit,
      lockNote: loaded.lock.note,
      version: loaded.set.version,
      authoredBy: loaded.set.authoredBy,
      checkedBy: loaded.set.checkedBy,
      createdAt: loaded.set.createdAt,
      cases: cases.length,
      items: new Set(cases.map((c) => c.item)).size,
    },
    runner: { commit: head.commit, dirty: head.dirty, node: process.version, startedAt, finishedAt: new Date().toISOString() },
    subjects: subjects.map(({ name, ran, skipped, description, version, policy, detector }) => ({ name, ran, skipped, description, version, policy, detector })),
    cases,
    results,
    metrics,
  }
}

/** Make the git worktree of 2e39dbf the "before" subject runs from. */
export function prepareBefore(target) {
  if (existsSync(target)) throw new Error(`${target} exists already`)
  git(REPO, 'worktree', 'add', '--detach', target, BEFORE_COMMIT)
  const want = JSON.stringify(JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')).dependencies)
  const have = JSON.stringify(JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')).dependencies)
  if (want !== have) throw new Error('2e39dbf has other dependencies than this checkout: run npm ci in the worktree')
  symlinkSync(path.join(REPO, 'node_modules'), path.join(target, 'node_modules'), 'dir')
  return target
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(argv) {
  const prepare = argValue(argv, '--prepare-before')
  if (prepare) {
    console.log(`2e39dbf worktree ready at ${prepareBefore(path.resolve(prepare))}`)
    return
  }
  const casesPath = path.resolve(argValue(argv, '--cases') ?? DEFAULT_CASES)
  const outDir = path.resolve(argValue(argv, '--out') ?? path.join(path.dirname(casesPath), 'results'))
  mkdirSync(outDir, { recursive: true })
  const report = await runEvaluation({
    casesPath,
    outDir,
    subjects: (argValue(argv, '--subjects') ?? ALL_SUBJECTS.join(',')).split(',').filter(Boolean),
    requireLock: !argv.includes('--no-lock-check'),
    label: argValue(argv, '--label'),
    beforeRoot: argValue(argv, '--before-root') && path.resolve(argValue(argv, '--before-root')),
    python: argValue(argv, '--python') ?? DEFAULT_PYTHON,
  })
  writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(path.join(outDir, 'report.md'), renderMarkdown(report))
  for (const s of report.subjects) console.log(`${s.name}: ${s.ran ? `${report.metrics[s.name].byCase.all.k} of ${report.metrics[s.name].byCase.all.n} correct, ${report.metrics[s.name].outcomes.invalid} invalid` : `not run (${s.skipped})`}`)
  console.log(`Reports: ${path.join(outDir, 'report.md')} and report.json`)
  if (report.subjects.some((s) => s.ran && report.metrics[s.name].outcomes.invalid)) process.exitCode = 3
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 2
  })
}

