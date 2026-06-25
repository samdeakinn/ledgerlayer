import { ensureSchema, seedDefaultData, getHousehold } from './_lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await ensureSchema();
    await seedDefaultData();
    const data = await getHousehold('default');
    res.json({ ok: true, message: 'Demo data seeded', entityCount: data?.entityList?.length || 0 });
  } catch (e) {
    console.error('Seed error:', e);
    res.status(500).json({ error: e.message });
  }
}
