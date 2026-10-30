// Synthetic bucket taxonomy shipped for the demo store. Replace with your own.

export const DEFAULT_BUCKET = "unsorted";

export const BUCKETS = Object.freeze([
  { id: "unsorted", label: "Unsorted", description: "Default landing spot for captures that have not been triaged." },
  { id: "projects", label: "Projects", description: "Plans, milestones, status notes and open questions for active projects." },
  { id: "projects-research", label: "Research", parent: "projects", description: "Reading notes, experiment results, benchmarks and literature summaries." },
  { id: "decisions", label: "Decisions", description: "Choices made, alternatives considered and the reasoning behind them." },
  { id: "reading", label: "Reading", description: "Articles, papers and books to read or already read, with short takeaways." },
  { id: "operations", label: "Operations", description: "Runbooks, checklists, incidents, tooling and process improvements." },
  { id: "ideas", label: "Ideas", description: "Loose product ideas, feature sketches and things to explore later." },
]);

export const BUCKET_IDS = Object.freeze(new Set(BUCKETS.map((b) => b.id)));

export function isKnownBucket(id) {
  return BUCKET_IDS.has(id);
}
