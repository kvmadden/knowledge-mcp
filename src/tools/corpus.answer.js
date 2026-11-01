import { z } from 'zod'
import { answer } from '../lib/corpus.js'
export const name = 'corpus.answer'
export const access = 'read'
export const config = {
  description: 'Retrieve an exact cited passage from the public health or fictional demo collection. Offline snapshots, not clinical advice.',
  inputSchema: { question: z.string().min(1).max(2000), collection: z.enum(['public', 'fictional']).default('public') },
}
export function run({ question, collection }) {
  const result = answer(question, collection)
  return { text: JSON.stringify(result), structured: result }
}
