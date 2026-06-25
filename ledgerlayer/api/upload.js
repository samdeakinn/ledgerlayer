import { put } from '@vercel/blob';
import { sql } from '@vercel/postgres';
import { ensureSchema, seedDefaultData } from './_lib/db.js';
import { extractFromText } from './_lib/llm.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await ensureSchema();
    await seedDefaultData();

    const householdId = req.headers['x-household-id'] || 'default';

    const blob = await put(req.headers['x-file-name'] || 'document.pdf', req, {
      access: 'public',
      addRandomSuffix: true,
    });

    let extractedText = '';
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const response = await fetch(blob.url);
      const arrayBuffer = await response.arrayBuffer();
      const pdfData = await pdfParse(Buffer.from(arrayBuffer));
      extractedText = pdfData.text;
    } catch (parseErr) {
      console.error('PDF parse error:', parseErr.message);
    }

    let extraction = null;
    if (extractedText && extractedText.length > 50) {
      extraction = await extractFromText(extractedText.slice(0, 30000));
    }

    const docResult = await sql`
      INSERT INTO documents (household_id, entity_id, entity_name, name, blob_url, extracted_text, date, size)
      VALUES (${householdId}, '', '', ${req.headers['x-file-name'] || 'document.pdf'}, ${blob.url}, ${extractedText.slice(0, 50000)}, ${new Date().toISOString().split('T')[0]}, ${(blob.size || 0).toString() + ' bytes'})
      RETURNING id
    `;
    const docId = docResult.rows[0]?.id;

    const created = { entities: [], people: [], obligations: [], documents: [] };

    if (extraction && docId) {
      for (const ent of (extraction.entities || [])) {
        const eid = ent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        await sql`INSERT INTO entities (id, household_id, name, meta, type) VALUES (${eid}, ${householdId}, ${ent.name}, ${ent.meta || ''}, ${ent.type || 'entity'}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;
        created.entities.push(ent.name);
      }

      for (const p of (extraction.people || [])) {
        const pid = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        await sql`INSERT INTO people (id, household_id, name, title, roles) VALUES (${pid}, ${householdId}, ${p.name}, ${p.role || ''}, ${p.entities || []}) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;
        created.people.push(p.name);
      }

      for (const o of (extraction.obligations || [])) {
        const entityId = o.entity ? o.entity.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) : '';
        await sql`INSERT INTO obligations (household_id, entity_id, title, due_date, due_fmt, entity_name, status) VALUES (${householdId}, ${entityId}, ${o.title}, ${o.due || ''}, ${o.due || ''}, ${o.entity || ''}, ${o.status || 'planned'})`;
        created.obligations.push(o.title);
      }

      for (const d of (extraction.documents || [])) {
        const entityId = d.entity ? d.entity.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) : '';
        await sql`INSERT INTO documents (household_id, entity_id, entity_name, name, doc_type, date) VALUES (${householdId}, ${entityId}, ${d.entity || ''}, ${d.name}, ${d.type || ''}, ${d.date || ''})`;
        created.documents.push(d.name);
      }
    }

    res.json({
      ok: true,
      blob: { url: blob.url, size: blob.size },
      extracted: !!extraction,
      textLength: extractedText.length,
      created,
    });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message });
  }
}
