import fs from 'node:fs';

const DATA_FILE = process.env.DATA_FILE || 'latest.json';
const API_BASE = process.env.TROPELA_API_BASE || 'https://api.tropela.eus/v2';
const MIN_STAGE_RECORDS = Number(process.env.MIN_STAGE_RECORDS || 20);

const read = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const write = data => fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
const num = v => Number(v || 0);

function selectedDorsals(data) {
  const set = new Set();
  for (const e of data.equipos || []) {
    for (const id of e.detalle?.dorsal_selection || []) {
      set.add(Number(id));
    }
  }
  return set;
}

function timeline(data) {
  const byDorsal = new Map();

  for (const e of data.equipos || []) {
    for (const r of e.detalle?.results || []) {
      const d = Number(r.dorsal);
      const s = Number(r.stage);
      const a = num(r.aggregate_points);

      if (!byDorsal.has(d)) {
        byDorsal.set(d, new Map());
      }

      const m = byDorsal.get(d);

      if (!m.has(s) || a > m.get(s)) {
        m.set(s, a);
      }
    }
  }

  return byDorsal;
}

function aggregateBefore(tl, dorsal, stage) {
  let bestStage = -Infinity;
  let value = 0;

  const m = tl.get(Number(dorsal));

  if (!m) {
    return 0;
  }

  for (const [s, a] of m) {
    if (s < stage && s > bestStage) {
      bestStage = s;
      value = a;
    }
  }

  return value;
}

function aggregateAtOrBefore(tl, dorsal, stage) {
  let bestStage = -Infinity;
  let value = 0;

  const m = tl.get(Number(dorsal));

  if (!m) {
    return 0;
  }

  for (const [s, a] of m) {
    if (s <= stage && s > bestStage) {
      bestStage = s;
      value = a;
    }
  }

  return value;
}

async function fetchStage(raceId, stageId) {
  const url =
    `${API_BASE}/races/${raceId}/stages/${stageId}/points/?aggregate=true`;

  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'txami-galdakao-vuelta-2026-updater/1.0'
    }
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`Tropela ${stageId}: HTTP ${res.status}`);
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new Error(`Tropela ${stageId}: respuesta inesperada`);
  }

  return data;
}

function apiMap(records) {
  const m = new Map();

  for (const x of records || []) {
    const did = Number(x?.dorsal?.id);

    if (did) {
      m.set(did, num(x.aggregate_points));
    }
  }

  return m;
}

function needsReconcile(data, stageId, records) {
  const selected = selectedDorsals(data);
  const api = apiMap(records);
  const tl = timeline(data);

  for (const did of selected) {
    if (!api.has(did)) {
      continue;
    }

    if (aggregateAtOrBefore(tl, did, stageId) !== api.get(did)) {
      return true;
    }
  }

  return false;
}

function rankRows(rows, valueKey, priorKey) {
  return [...rows].sort(
    (a, b) =>
      num(b[valueKey]) - num(a[valueKey]) ||
      num(a[priorKey] ?? 999999) - num(b[priorKey] ?? 999999) ||
      String(a.name).localeCompare(String(b.name), 'es')
  );
}

function reconcile(data, stageId, records) {
  const api = apiMap(records);

  let tl = timeline(data);

  const before = new Map();

  for (const did of selectedDorsals(data)) {
    before.set(did, aggregateBefore(tl, did, stageId));
  }

  for (const e of data.equipos || []) {
    const d = e.detalle || {};

    d.results = (d.results || []).filter(
      r => Number(r.stage) !== stageId
    );

    for (const did0 of d.dorsal_selection || []) {
      const did = Number(did0);

      if (!api.has(did)) {
        continue;
      }

      const agg = api.get(did);
      const delta = agg - num(before.get(did));

      d.results.push({
        stage: stageId,
        dorsal: did,
        points: delta,
        aggregate_points: agg
      });
    }

    d.results.sort(
      (a, b) =>
        Number(a.stage) - Number(b.stage) ||
        Number(a.dorsal) - Number(b.dorsal)
    );
  }

  tl = timeline(data);

  const previousStand = new Map();

  for (const e of data.equipos || []) {
    const prev = (e.detalle?.standings || [])
      .filter(s => Number(s.stage) < stageId)
      .sort((a, b) => Number(b.stage) - Number(a.stage))[0];

    previousStand.set(
      Number(e.porra_id),
      prev?.aggregate_position ?? 999999
    );
  }

  const rows = [];

  for (const e of data.equipos || []) {
    const ids = (e.detalle?.dorsal_selection || []).map(Number);

    let stagePoints = 0;
    let aggregatePoints = 0;

    for (const did of ids) {
      stagePoints += api.has(did)
        ? api.get(did) - num(before.get(did))
        : 0;

      aggregatePoints += aggregateAtOrBefore(
        tl,
        did,
        stageId
      );
    }

    rows.push({
      porra: Number(e.porra_id),
      name: e.usuario?.name || e.usuario?.username || '',
      points: stagePoints,
      aggregate_points: aggregatePoints,
      prior: previousStand.get(Number(e.porra_id))
    });
  }

  const stageRank = rankRows(rows, 'points', 'prior');
  const aggRank = rankRows(rows, 'aggregate_points', 'prior');

  const stagePos = new Map(
    stageRank.map((r, i) => [r.porra, i + 1])
  );

  const aggPos = new Map(
    aggRank.map((r, i) => [r.porra, i + 1])
  );

  data.standings = (data.standings || []).filter(
    s => Number(s.stage) !== stageId
  );

  for (const row of rows) {
    const st = {
      stage: stageId,
      porra: row.porra,
      position: stagePos.get(row.porra),
      points: row.points,
      aggregate_position: aggPos.get(row.porra),
      aggregate_points: row.aggregate_points
    };

    data.standings.push(st);

    const e = data.equipos.find(
      x => Number(x.porra_id) === row.porra
    );

    e.detalle.standings = (e.detalle.standings || []).filter(
      s => Number(s.stage) !== stageId
    );

    e.detalle.standings.push({ ...st });

    delete e.detalle.standings.at(-1).porra;

    e.detalle.standings.sort(
      (a, b) => Number(a.stage) - Number(b.stage)
    );
  }

  data.standings.sort(
    (a, b) =>
      Number(a.stage) - Number(b.stage) ||
      Number(a.aggregate_position) -
        Number(b.aggregate_position)
  );
}

const data = read();

const raceId = Number(data.metadata?.race_id);

if (!raceId) {
  throw new Error(
    'latest.json no contiene metadata.race_id'
  );
}

let current = Number(data.metadata?.stage_id);

if (!current) {
  throw new Error(
    'latest.json no contiene metadata.stage_id'
  );
}

let changed = false;

// Revisa la etapa actual por si Tropela corrige
// o completa puntos después.
const currentRecords = await fetchStage(
  raceId,
  current
);

if (
  currentRecords &&
  currentRecords.length >= MIN_STAGE_RECORDS &&
  needsReconcile(data, current, currentRecords)
) {
  reconcile(data, current, currentRecords);

  changed = true;

  console.log(
    `Etapa ${current}: corregida/actualizada ` +
    `(${currentRecords.length} registros).`
  );
}

// Incorpora todas las etapas nuevas consecutivas
// que ya estén publicadas.
for (let next = current + 1; ; next++) {
  const records = await fetchStage(
    raceId,
    next
  );

  if (records === null) {
    console.log(
      `Etapa ${next}: endpoint no disponible (404).`
    );

    break;
  }

  if (records.length < MIN_STAGE_RECORDS) {
    console.log(
      `Etapa ${next}: todavía no publicada ` +
      `(${records.length} registros).`
    );

    break;
  }

  reconcile(data, next, records);

  current = next;
  changed = true;

  data.metadata.stage_id = current;

  data.metadata.auto_points_stage =
    (data.metadata.auto_points_stage || 0) + 1;

  console.log(
    `Etapa ${next}: incorporada ` +
    `(${records.length} registros).`
  );
}

if (changed) {
  data.metadata.descargado_en =
    new Date().toISOString();

  data.metadata.auto_points = true;

  data.metadata.auto_updated_at =
    data.metadata.descargado_en;

  write(data);

  console.log(
    `latest.json actualizado hasta stage_id ` +
    `${data.metadata.stage_id}.`
  );
} else {
  console.log(
    'Sin cambios; latest.json se mantiene igual.'
  );
}
