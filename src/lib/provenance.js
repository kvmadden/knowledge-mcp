import { z } from 'zod'

// Caller assertions are traceability, not proof that a source is correct.
export const provenanceSchema = z.object({
  source: z.string().min(1).max(2000).describe('Source label or URL. Do not include private identifiers.'),
  observedAt: z.iso.date().optional().describe('Date of the source, YYYY-MM-DD. Omit if unknown.'),
  trust: z.enum(['asserted', 'untrusted', 'unspecified']).optional().describe('Caller assertion. Untrusted sources cannot be promoted to stored facts.'),
}).strict()
