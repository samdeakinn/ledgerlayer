import { sql } from '@vercel/postgres';
import { ensureSchema, getHousehold } from './_lib/db.js';
import { embedText, answerQuery } from './_lib/llm.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await ensureSchema();

    const { query, householdId = 'default', history = [] } = req.body || {};
    if (!query || !query.trim()) return res.status(400).json({ error: 'Query is required' });

    const context = await getHousehold(householdId);

    let relevantChunks = [];
    const embedding = await embedText(query);
    if (embedding) {
      const embStr = `[${embedding.join(',')}]`;
      const { rows: chunks } = await sql`
        SELECT content, chunk_index, metadata
        FROM document_chunks
        WHERE household_id = ${householdId}
        ORDER BY embedding <=> ${embStr}::real[]
        LIMIT 5
      `;
      relevantChunks = chunks;
    }

    const enrichedContext = {
      ...context,
      relevantChunks: relevantChunks.map(c => ({
        content: c.content,
        source: c.metadata?.source || 'document',
      })),
    };

    const answer = await answerQuery(query, enrichedContext, history);

    const suggestions = [
      "What's our biggest risk this quarter?",
      'Which advisers need to coordinate?',
      'Summarise succession readiness',
      'What entities does Sanjay Patel have access to?',
    ];

    const sources = [];
    if (context?.docs?.length) {
      sources.push({ icon: 'DOC', name: `${context.docs.length} documents indexed`, meta: 'Across all entities' });
    }
    if (context?.advisers?.length) {
      sources.push({ icon: 'SP', name: context.advisers[0].name, meta: context.advisers[0].role });
    }

    res.json({
      text: answer,
      sources: sources.slice(0, 4),
      suggestions,
      actions: [
        { label: 'Open dashboard', target: 'app' },
        { label: 'View documents', target: 'docs' },
      ],
    });
  } catch (e) {
    console.error('Intel error:', e);
    res.status(500).json({ error: e.message });
  }
}
