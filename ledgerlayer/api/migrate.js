import { ensureSchema, seedDefaultData } from './_lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSchema();
    await seedDefaultData();
    res.status(200).json({ ok: true, message: 'Schema ready, data seeded' });
  } catch (e) {
    console.error('Migration error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
