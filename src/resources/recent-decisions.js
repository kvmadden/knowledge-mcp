export const name = "recent-decisions";
export const access = "read";
export const uri = "knowledge://records/recent-decisions";
export const config = {
  title: "Recent decisions",
  description: "The ten most recently updated decision records, as JSON.",
  mimeType: "application/json",
};

export function read({ records }) {
  const rows = records.recentDecisions(10);
  return JSON.stringify({ count: rows.length, decisions: rows }, null, 2);
}
