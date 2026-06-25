import { sql } from '@vercel/postgres';

let migrated = false;

export async function ensureSchema() {
  if (migrated) return;
  await sql`
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY DEFAULT 'default',
      name TEXT NOT NULL DEFAULT 'Turner Household',
      description TEXT DEFAULT '',
      net_worth TEXT DEFAULT '',
      net_worth_sub TEXT DEFAULT '',
      badges TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      meta TEXT DEFAULT '',
      tag_class TEXT DEFAULT '',
      tag_label TEXT DEFAULT '',
      badges TEXT[] DEFAULT '{}',
      type TEXT DEFAULT 'entity',
      parent_id TEXT REFERENCES entities(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS entity_people (
      id SERIAL PRIMARY KEY,
      entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
      init TEXT DEFAULT '',
      name TEXT NOT NULL,
      role TEXT DEFAULT ''
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
      init TEXT DEFAULT '',
      name TEXT NOT NULL,
      meta TEXT DEFAULT '',
      title TEXT DEFAULT '',
      avatar_init TEXT DEFAULT '',
      email TEXT DEFAULT '',
      roles TEXT[] DEFAULT '{}',
      contact TEXT[] DEFAULT '{}',
      permissions TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS obligations (
      id SERIAL PRIMARY KEY,
      household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
      entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due_date TEXT DEFAULT '',
      due_fmt TEXT DEFAULT '',
      responsible TEXT DEFAULT '',
      entity_name TEXT DEFAULT '',
      entity2 TEXT DEFAULT '',
      status TEXT DEFAULT 'planned',
      overdue BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
      entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
      entity_name TEXT DEFAULT '',
      entity_group TEXT DEFAULT '',
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'pdf',
      doc_type TEXT DEFAULT '',
      date TEXT DEFAULT '',
      size TEXT DEFAULT '',
      blob_url TEXT DEFAULT '',
      extracted_text TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id SERIAL PRIMARY KEY,
      household_id TEXT DEFAULT 'default',
      document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER DEFAULT 0,
      content TEXT NOT NULL,
      embedding REAL[] DEFAULT '{}',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS advisers (
      id SERIAL PRIMARY KEY,
      household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      firm TEXT DEFAULT '',
      role TEXT DEFAULT '',
      entities TEXT[] DEFAULT '{}',
      last_access TEXT DEFAULT '',
      last_action TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS timeline_events (
      id SERIAL PRIMARY KEY,
      household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
      year TEXT DEFAULT '',
      event_type TEXT DEFAULT '',
      dot TEXT DEFAULT '',
      title TEXT NOT NULL,
      meta TEXT DEFAULT '',
      event_date TEXT DEFAULT ''
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS insights (
      id SERIAL PRIMARY KEY,
      household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
      severity TEXT DEFAULT 'low',
      title TEXT NOT NULL,
      meta TEXT DEFAULT '',
      action_text TEXT DEFAULT '',
      action_target TEXT DEFAULT ''
    );
  `;
  migrated = true;
}

export async function getHousehold(id = 'default') {
  const { rows: hh } = await sql`SELECT * FROM households WHERE id = ${id} LIMIT 1`;
  if (!hh.length) return null;
  const household = hh[0];
  const { rows: entities } = await sql`SELECT * FROM entities WHERE household_id = ${id}`;
  const { rows: people } = await sql`SELECT * FROM people WHERE household_id = ${id}`;
  const { rows: obligations } = await sql`SELECT * FROM obligations WHERE household_id = ${id} ORDER BY id`;
  const { rows: docs } = await sql`SELECT * FROM documents WHERE household_id = ${id} ORDER BY id`;
  const { rows: advisers } = await sql`SELECT * FROM advisers WHERE household_id = ${id} ORDER BY id`;
  const { rows: timelineRows } = await sql`SELECT * FROM timeline_events WHERE household_id = ${id} ORDER BY id`;
  const { rows: insights } = await sql`SELECT * FROM insights WHERE household_id = ${id} ORDER BY id`;

  const entityMap = {};
  for (const e of entities) {
    const { rows: ep } = await sql`SELECT * FROM entity_people WHERE entity_id = ${e.id}`;
    const { rows: ed } = await sql`SELECT id, name, icon, doc_type, date, size FROM documents WHERE entity_id = ${e.id}`;
    const { rows: eo } = await sql`SELECT id, title, due_date AS due, responsible AS resp, status, due_fmt FROM obligations WHERE entity_id = ${e.id}`;
    entityMap[e.id] = {
      name: e.name, meta: e.meta,
      tagClass: e.tag_class, tagLabel: e.tag_label,
      badges: e.badges || [],
      people: ep.map(p => ({ init: p.init, name: p.name, role: p.role })),
      docs: ed.map(d => ({ name: d.name, meta: `${d.icon} · Added ${d.date || ''}`, date: d.date })),
      obligations: eo.map(o => ({ title: o.title, due: o.due, resp: o.resp, status: o.status === 'risk' ? 'ho-status--risk' : o.status === 'progress' ? 'ho-status--progress' : o.status === 'complete' ? 'ho-status--complete' : 'ho-status--planned', label: o.status })),
    };
  }

  const tlByYear = {};
  for (const ev of timelineRows) {
    if (!tlByYear[ev.year]) tlByYear[ev.year] = [];
    tlByYear[ev.year].push({
      type: ev.event_type, dot: ev.dot,
      title: ev.title, meta: ev.meta, date: ev.event_date,
    });
  }
  const timeline = Object.entries(tlByYear).map(([year, events]) => ({ year: parseInt(year), events }));

  return {
    household: {
      name: household.name,
      desc: household.description,
      netWorth: household.net_worth,
      netWorthSub: household.net_worth_sub,
      badges: household.badges || [],
    },
    entityList: entities.map(e => e.name),
    insights: insights.map(i => ({
      severity: i.severity,
      title: i.title,
      meta: i.meta,
      action: i.action_text,
      target: i.action_target,
    })),
    riskSummary: [
      { score: obligations.filter(o => o.overdue).length.toString() || '0', label: 'At-risk items' },
      { score: advisers.length.toString(), label: 'Active advisers' },
      { score: docs.length.toString(), label: 'Documents indexed' },
    ],
    advisers: advisers.map(a => ({
      name: a.name, firm: a.firm, role: a.role,
      entities: a.entities || [],
      lastAccess: a.last_access, lastAction: a.last_action,
    })),
    timeline,
    docs: docs.map(d => ({
      entity: d.entity_name,
      entityGroup: d.entity_group,
      name: d.name,
      icon: d.icon,
      type: d.doc_type,
      date: d.date,
      size: d.size,
    })),
    obligations: obligations.map(o => ({
      title: o.title,
      due: o.due_date,
      dueFmt: o.due_fmt,
      resp: o.responsible,
      entity2: o.entity2,
      status: o.status === 'risk' ? 'ho-status--risk' : o.status === 'progress' ? 'ho-status--progress' : o.status === 'complete' ? 'ho-status--complete' : 'ho-status--planned',
      label: o.status,
      overdue: o.overdue,
    })),
    feed: [],
  };
}

export async function seedDefaultData() {
  const existing = await getHousehold('default');
  if (existing) return;

  await sql`INSERT INTO households (id, name, description, net_worth, net_worth_sub, badges) VALUES (
    'default',
    'Turner Household',
    'Family office for the Turner family · London & Edinburgh',
    '£12.4M',
    'Across 7 entities · Updated Nov 2025',
    ARRAY['Family office','Wealth planning','Multigenerational']
  ) ON CONFLICT (id) DO NOTHING;`;

  await sql`INSERT INTO entities (id, household_id, name, meta, tag_class, tag_label, badges, type) VALUES
    ('holdings','default','Turner Holdings Ltd','Holding company · Reg. England & Wales · Co. no. 08841234','ho-tag-company','Ltd',ARRAY['Active','Incorporated 2014','2 directors'],'company'),
    ('property-services','default','Turner Property Services Ltd','Operating company · Reg. England & Wales · Co. no. 11203847','ho-tag-company','Ltd',ARRAY['Active','Incorporated 2018','1 director'],'company'),
    ('family-trust','default','Turner Family Trust','Bare trust · Established 2015 · Trustees: James & Sarah Turner','ho-tag-trust','Trust',ARRAY['Active','Established 2015','2 trustees','3 beneficiaries'],'trust'),
    ('discretionary-trust','default','Turner Discretionary Trust','Discretionary trust · Established 2019','ho-tag-trust','Trust',ARRAY['Active','Established 2019','2 trustees'],'trust'),
    ('london-property','default','12 Ladbroke Grove, London W11','Principal residence · Freehold · Purchased 2017','ho-tag-property','Property',ARRAY['Freehold','Purchased 2017','Primary residence'],'property'),
    ('edinburgh-property','default','4 Thistle Lane, Edinburgh EH3','Investment property · Leasehold · Purchased 2020','ho-tag-property','Property',ARRAY['Leasehold','Purchased 2020','Investment'],'property')
  ON CONFLICT (id) DO NOTHING;`;

  await sql`INSERT INTO people (id, household_id, init, name, meta, title, avatar_init, email, roles, contact) VALUES
    ('james','default','JT','James Turner','Principal · Age 52','Principal','JT','james@turner.io',ARRAY['Principal','Director','Trustee'],ARRAY['james@turner.io','+44 7700 123456']),
    ('sarah','default','ST','Sarah Turner','Spouse · Age 48','Spouse','ST','sarah@turner.io',ARRAY['Spouse','Director','Trustee'],ARRAY['sarah@turner.io','+44 7700 123457']),
    ('oliver','default','OT','Oliver Turner','Beneficiary · Age 17','Beneficiary','OT','',ARRAY['Beneficiary'],ARRAY['']),
    ('eleanor','default','ET','Eleanor Turner','Beneficiary · Age 14','Beneficiary','ET','',ARRAY['Beneficiary'],ARRAY['']),
    ('sanjay','default','SP','Sanjay Patel','Tax adviser · Firma Advisory LLP','Tax adviser','SP','sanjay@firma.co.uk',ARRAY['Tax adviser'],ARRAY['sanjay@firma.co.uk']),
    ('bridget','default','BS','Bridget Singh','Solicitor · Singh & Cooper','Solicitor','BS','bridget@singhcooper.com',ARRAY['Solicitor'],ARRAY['bridget@singhcooper.com']),
    ('marcus','default','MW','Marcus Webb','Wealth manager · Webb Capital','Wealth manager','MW','marcus@webbcapital.com',ARRAY['Wealth manager'],ARRAY['marcus@webbcapital.com'])
  ON CONFLICT (id) DO NOTHING;`;

  await sql`INSERT INTO entity_people (entity_id, init, name, role) VALUES
    ('holdings','JT','James Turner','Director · Appointed Jan 2014'),
    ('holdings','ST','Sarah Turner','Director · Appointed Mar 2016'),
    ('property-services','JT','James Turner','Sole director · Appointed May 2018'),
    ('family-trust','JT','James Turner','Trustee · Appointed Jan 2015'),
    ('family-trust','ST','Sarah Turner','Trustee · Appointed Jan 2015'),
    ('family-trust','OT','Oliver Turner','Beneficiary'),
    ('family-trust','ET','Eleanor Turner','Beneficiary'),
    ('discretionary-trust','JT','James Turner','Trustee · Appointed Sep 2019'),
    ('discretionary-trust','ST','Sarah Turner','Trustee · Appointed Sep 2019'),
    ('london-property','JT','James Turner','Registered owner'),
    ('london-property','ST','Sarah Turner','Registered owner'),
    ('edinburgh-property','JT','James Turner','Registered owner')
  ON CONFLICT DO NOTHING;`;

  await sql`INSERT INTO obligations (household_id, entity_id, title, due_date, due_fmt, responsible, entity_name, entity2, status, overdue) VALUES
    ('default','holdings','Board resolution re dividend','2025-11-15','15 Nov 2025','Household','Turner Holdings Ltd','Turner Holdings','progress',false),
    ('default','holdings','Confirmation statement filing','2026-02-28','28 Feb 2026','Firm A – Tax','Turner Holdings Ltd','Turner Holdings','planned',false),
    ('default','property-services','VAT return Q3','2025-10-07','7 Oct 2025','Firm A – Tax','Turner Property Services Ltd','Turner Property Services','risk',true),
    ('default','property-services','Annual accounts filing','2025-12-31','31 Dec 2025','Firm A – Tax','Turner Property Services Ltd','Turner Property Services','progress',false),
    ('default','family-trust','Annual review meeting','2025-11-22','22 Nov 2025','Firm B – Legal','Turner Family Trust','Turner Family Trust','planned',false),
    ('default','family-trust','Trustee resolution — distribution','2025-12-15','15 Dec 2025','Household','Turner Family Trust','Turner Family Trust','planned',false),
    ('default','discretionary-trust','Five-year trust review','2024-09-30','30 Sep 2024','Firm B – Legal','Turner Discretionary Trust','Turner Discretionary Trust','risk',true),
    ('default','london-property','Mortgage renewal','2026-03-15','15 Mar 2026','Household','12 Ladbroke Grove London W11','12 Ladbroke Grove','planned',false)
  ON CONFLICT DO NOTHING;`;

  await sql`INSERT INTO documents (household_id, entity_id, entity_name, entity_group, name, icon, doc_type, date, size) VALUES
    ('default','holdings','Turner Holdings Ltd','Turner Holdings Ltd','Certificate of Incorporation','pdf','Corporate','Jan 2024','142 KB'),
    ('default','holdings','Turner Holdings Ltd','Turner Holdings Ltd','Articles of Association','pdf','Corporate','Jan 2024','88 KB'),
    ('default','holdings','Turner Holdings Ltd','Turner Holdings Ltd','Annual accounts 2023–24','xls','Accounts','Oct 2024','312 KB'),
    ('default','holdings','Turner Holdings Ltd','Turner Holdings Ltd','Shareholders'' agreement','pdf','Legal','Jun 2019','204 KB'),
    ('default','property-services','Turner Property Services Ltd','Turner Property Services Ltd','Certificate of Incorporation','pdf','Corporate','Jan 2024','138 KB'),
    ('default','property-services','Turner Property Services Ltd','Turner Property Services Ltd','Annual accounts 2022–23','xls','Accounts','Dec 2023','278 KB'),
    ('default','property-services','Turner Property Services Ltd','Turner Property Services Ltd','VAT registration certificate','pdf','Tax','Jun 2018','64 KB'),
    ('default','family-trust','Turner Family Trust','Turner Family Trust','Trust deed','pdf','Legal','Jan 2015','318 KB'),
    ('default','family-trust','Turner Family Trust','Turner Family Trust','Letter of wishes','doc','Legal','Mar 2021','52 KB'),
    ('default','family-trust','Turner Family Trust','Turner Family Trust','Annual accounts 2023','xls','Accounts','Apr 2024','188 KB'),
    ('default','london-property','12 Ladbroke Grove, London','Properties','Title deeds','pdf','Property','Aug 2017','1.2 MB'),
    ('default','london-property','12 Ladbroke Grove, London','Properties','Buildings insurance certificate','pdf','Insurance','Jan 2025','96 KB'),
    ('default','edinburgh-property','4 Thistle Lane, Edinburgh','Properties','Lease agreement','pdf','Property','Mar 2020','224 KB'),
    ('default','edinburgh-property','4 Thistle Lane, Edinburgh','Properties','Gas safety certificate','pdf','Compliance','Dec 2024','48 KB')
  ON CONFLICT DO NOTHING;`;

  await sql`INSERT INTO advisers (household_id, name, firm, role, entities, last_access, last_action) VALUES
    ('default','Sanjay Patel','Firma Advisory LLP','Tax adviser',ARRAY['Turner Property Services Ltd — Tax & accounts','James Turner — SIPP — Read-only'],'Last accessed 2h ago','Viewed obligations for Turner Property Services Ltd'),
    ('default','Bridget Singh','Singh & Cooper Solicitors','Solicitor',ARRAY['Turner Family Trust — Full access','Turner Discretionary Trust — Full access'],'Last accessed 3 days ago','Reviewed trust deed and letter of wishes'),
    ('default','Marcus Webb','Webb Capital Management','Wealth manager',ARRAY['Turner Holdings Ltd — Read-only'],'Last accessed 1 week ago','Viewed consolidated position summary')
  ON CONFLICT DO NOTHING;`;

  await sql`INSERT INTO timeline_events (household_id, year, event_type, dot, title, meta, event_date) VALUES
    ('default','2025','tl-obligation','OBL','VAT return Q3 — marked at risk','Turner Property Services Ltd · Firm A – Tax','Oct 2025'),
    ('default','2025','tl-access','ACC','Sanjay Patel granted access to James Turner SIPP','Read-only · Granted by James Turner','Sep 2025'),
    ('default','2024','tl-doc','DOC','Annual accounts 2023–24 uploaded','Turner Holdings Ltd · Added by James Turner','Oct 2024'),
    ('default','2024','tl-doc','DOC','Gas safety certificate renewed','4 Thistle Lane, Edinburgh','Dec 2024'),
    ('default','2024','tl-doc','DOC','ISA application 2024–25 filed','James Turner – ISA · Hargreaves Lansdown','Apr 2024'),
    ('default','2023','tl-obligation','OBL','Annual accounts 2022–23 filed — complete','Turner Property Services Ltd · Firm A – Tax','Dec 2023'),
    ('default','2023','tl-access','ACC','Marcus Webb granted access to Turner Holdings','Read-only · Granted by James Turner','Jun 2023'),
    ('default','2021','tl-legal','LGL','Letter of wishes updated — Turner Family Trust','Drafted by Bridget Singh · Singh & Cooper','Mar 2021'),
    ('default','2020','tl-property','PRO','4 Thistle Lane, Edinburgh purchased','Investment property · Leasehold','Mar 2020'),
    ('default','2019','tl-entity','ENT','Turner Discretionary Trust established','Trustees: James & Sarah Turner','Sep 2019'),
    ('default','2019','tl-legal','LGL','Shareholders'' agreement executed — Turner Holdings','James & Sarah Turner · Singh & Cooper','Jun 2019'),
    ('default','2018','tl-entity','ENT','Turner Property Services Ltd incorporated','Operating company · Sole director: James Turner','May 2018'),
    ('default','2017','tl-property','PRO','12 Ladbroke Grove, London purchased','Principal residence · Freehold','Aug 2017'),
    ('default','2015','tl-entity','ENT','Turner Family Trust established','Bare trust · Trustees: James & Sarah Turner','Jan 2015'),
    ('default','2014','tl-entity','ENT','Turner Holdings Ltd incorporated','Holding company · Director: James Turner','Jan 2014')
  ON CONFLICT DO NOTHING;`;

  await sql`INSERT INTO insights (household_id, severity, title, meta, action_text, action_target) VALUES
    ('default','high','VAT return Q3 needs owner confirmation','Overdue since 7 Oct 2025 · Assigned to Firm A - Tax','Open overdue','overdue'),
    ('default','med','Trust annual review has no agenda attached','Due 22 Nov 2025 · Legal adviser has full trust access','Show trust docs','docs'),
    ('default','low','SIPP review and contribution sit with the same adviser','Useful consolidation point for January planning','View SIPP','sipp')
  ON CONFLICT DO NOTHING;`;
}
