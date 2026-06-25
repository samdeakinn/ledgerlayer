import { ensureSchema, getHousehold, seedDefaultData } from './_lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureSchema();
    await seedDefaultData();

    const id = req.query.id || 'default';
    const data = await getHousehold(id);
    if (!data) return res.status(404).json({ error: 'Household not found' });

    const hh = data.household;
    let entities = [];
    for (const [eid, e] of Object.entries(data.entityMap || {})) {
      entities.push(e);
    }

    res.json({
      household: hh,
      entityList: data.entityList,
      insights: data.insights,
      riskSummary: data.riskSummary,
      advisers: data.advisers,
      timeline: data.timeline,
      docs: data.docs,
      obligations: data.obligations,
      feed: [],
    });
  } catch (e) {
    console.error('Household error:', e);
    res.status(500).json({ error: e.message });
  }
}
