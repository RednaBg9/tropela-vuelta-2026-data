import fs from 'node:fs';

const DATA_FILE = process.env.DATA_FILE || 'latest.json';
const API_BASE =
  process.env.TROPELA_API_BASE ||
  'https://api.tropela.eus/v2';

const VUELTA_BASE =
  'https://www.lavuelta.es';

const MIN_STAGE_RECORDS =
  Number(
    process.env.MIN_STAGE_RECORDS ||
    20
  );

const VUELTA_RANKINGS = {
  individual: 'itg',
  points: 'ipg',
  mountain: 'img',
  young: 'ijg',
  teams: 'etg'
};

const read = () =>
  JSON.parse(
    fs.readFileSync(
      DATA_FILE,
      'utf8'
    )
  );

const write = data =>
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data),
    'utf8'
  );

const num = v =>
  Number(v || 0);

const sameJson = (a, b) =>
  JSON.stringify(a) ===
  JSON.stringify(b);


function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .replace(
      /&nbsp;|\u00a0/g,
      ' '
    )
    .toUpperCase()
    .replace(
      /[^A-Z0-9]+/g,
      ' '
    )
    .trim();
}


function decodeHtml(s) {
  return String(s || '')
    .replace(
      /&nbsp;/gi,
      ' '
    )
    .replace(
      /&amp;/gi,
      '&'
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;|&apos;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      '<'
    )
    .replace(
      /&gt;/gi,
      '>'
    )
    .replace(
      /&#(\d+);/g,
      (_, n) =>
        String.fromCodePoint(
          Number(n)
        )
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, n) =>
        String.fromCodePoint(
          parseInt(n, 16)
        )
    );
}


function stripTags(html) {
  return decodeHtml(
    String(html || '')
      .replace(
        /<br\s*\/?>/gi,
        ' '
      )
      .replace(
        /<[^>]+>/g,
        ' '
      )
  )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}


function parseTableRows(html) {
  const rows = [];

  for (
    const tr of
    String(html || '')
      .matchAll(
        /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
      )
  ) {
    const cells = [];

    for (
      const cell of
      tr[1].matchAll(
        /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi
      )
    ) {
      cells.push({
        html: cell[1],
        text:
          stripTags(
            cell[1]
          )
      });
    }

    if (cells.length) {
      rows.push(cells);
    }
  }

  return rows;
}


function bestNameFromCell(cell) {
  const candidates = [];

  for (
    const m of
    String(
      cell?.html || ''
    ).matchAll(
      /\b(?:alt|title)=["']([^"']+)["']/gi
    )
  ) {
    const value =
      decodeHtml(m[1])
        .replace(
          /\s+/g,
          ' '
        )
        .trim();

    if (
      value &&
      /[A-Za-zÀ-ÿ]/.test(
        value
      ) &&
      !/^(image|imagen|foto|flag|bandera)$/i.test(
        value
      )
    ) {
      candidates.push(
        value
      );
    }
  }

  const text =
    String(
      cell?.text || ''
    ).trim();

  if (text) {
    candidates.push(text);
  }

  candidates.sort(
    (a, b) =>
      normalizeText(b)
        .split(' ')
        .length -
      normalizeText(a)
        .split(' ')
        .length ||
      b.length -
      a.length
  );

  return candidates[0] || '';
}


function parseRiderRanking(
  html
) {
  const out = [];

  for (
    const cells of
    parseTableRows(html)
  ) {
    const position =
      Number(
        String(
          cells[0]?.text ||
          ''
        ).replace(
          /\D+/g,
          ''
        )
      );

    if (
      !Number.isFinite(
        position
      ) ||
      position <= 0 ||
      !cells[1]
    ) {
      continue;
    }

    out.push({
      position,

      name:
        bestNameFromCell(
          cells[1]
        ),

      shortName:
        cells[1]?.text ||
        '',

      bib:
        cells[2]?.text ||
        '',

      team:
        cells[4]?.text ||
        '',

      cells:
        cells.map(
          c => c.text
        )
    });
  }

  return out;
}


function parseTeamRanking(
  html
) {
  const out = [];

  for (
    const cells of
    parseTableRows(html)
  ) {
    const position =
      Number(
        String(
          cells[0]?.text ||
          ''
        ).replace(
          /\D+/g,
          ''
        )
      );

    if (
      !Number.isFinite(
        position
      ) ||
      position <= 0 ||
      !cells[1]
    ) {
      continue;
    }

    out.push({
      position,

      team:
        cells[1].text ||
        '',

      cells:
        cells.map(
          c => c.text
        )
    });
  }

  return out;
}


function selectedDorsals(
  data
) {
  const set =
    new Set();

  for (
    const e of
    data.equipos || []
  ) {
    for (
      const id of
      e.detalle
        ?.dorsal_selection ||
      []
    ) {
      set.add(
        Number(id)
      );
    }
  }

  return set;
}


function riderCatalog(
  data
) {
  const byDorsal =
    new Map();

  for (
    const e of
    data.equipos || []
  ) {
    for (
      const d of
      e.detalle?.dorsals ||
      []
    ) {
      const id =
        Number(d.id);

      if (
        !id ||
        byDorsal.has(id)
      ) {
        continue;
      }

      byDorsal.set(
        id,
        {
          dorsalId:
            id,

          teamId:
            Number(
              d.team
            ),

          firstName:
            d.rider
              ?.first_name ||
            '',

          lastName:
            d.rider
              ?.last_name ||
            '',

          name:
            `${
              d.rider
                ?.first_name ||
              ''
            } ${
              d.rider
                ?.last_name ||
              ''
            }`
              .replace(
                /\s+/g,
                ' '
              )
              .trim()
        }
      );
    }
  }

  return [
    ...byDorsal.values()
  ];
}


function matchOfficialRider(
  data,
  officialName
) {
  const target =
    normalizeText(
      officialName
    );

  if (!target) {
    return null;
  }

  const targetTokens =
    target
      .split(' ')
      .filter(Boolean);

  let best = null;
  let bestScore = -1;
  let tied = false;

  for (
    const r of
    riderCatalog(data)
  ) {
    const full =
      normalizeText(
        r.name
      );

    const first =
      normalizeText(
        r.firstName
      );

    const last =
      normalizeText(
        r.lastName
      );

    const firstWord =
      first
        .split(' ')
        .filter(Boolean)[0] ||
      '';

    const lastTokens =
      last
        .split(' ')
        .filter(Boolean);

    const targetFirst =
      targetTokens[0] ||
      '';

    const targetSurnameTokens =
      targetTokens.slice(1);

    const surnameOverlap =
      lastTokens.filter(
        t =>
          targetSurnameTokens
            .includes(t) ||
          targetTokens
            .includes(t)
      ).length;

    let score = 0;

    if (
      target === full
    ) {
      score += 1000;
    }

    if (
      full &&
      target.includes(full)
    ) {
      score += 500;
    }

    if (
      firstWord &&
      targetFirst ===
        firstWord
    ) {
      score += 120;
    } else if (
      firstWord &&
      targetFirst &&
      firstWord[0] ===
        targetFirst[0]
    ) {
      score += 45;
    }

    if (
      last &&
      target.includes(last)
    ) {
      score += 220;
    }

    score +=
      surnameOverlap *
      80;

    if (
      lastTokens.length &&
      targetTokens.at(-1) ===
        lastTokens.at(-1)
    ) {
      score += 90;
    }

    if (
      score < 1000 &&
      surnameOverlap === 0 &&
      !(
        last &&
        target.includes(last)
      )
    ) {
      continue;
    }

    if (
      score >
      bestScore
    ) {
      best = r;
      bestScore = score;
      tied = false;
    } else if (
      score ===
      bestScore
    ) {
      tied = true;
    }
  }

  return (
    bestScore >= 1000 ||
    (
      bestScore >= 120 &&
      !tied
    )
  )
    ? best
    : null;
}


function friendlyRiderName(
  data,
  officialName
) {
  return (
    matchOfficialRider(
      data,
      officialName
    )?.name ||
    String(
      officialName ||
      ''
    )
      .replace(
        /\s+/g,
        ' '
      )
      .trim()
  );
}


function buildTeamCatalog(
  data,
  individualRows
) {
  const votes =
    new Map();

  for (
    const row of
    individualRows || []
  ) {
    const rider =
      matchOfficialRider(
        data,
        row.name ||
        row.shortName
      );

    const teamName =
      String(
        row.cells?.[4] ||
        row.team ||
        ''
      ).trim();

    if (
      !rider?.teamId ||
      !teamName
    ) {
      continue;
    }

    const teamId =
      Number(
        rider.teamId
      );

    if (
      !votes.has(
        teamId
      )
    ) {
      votes.set(
        teamId,
        new Map()
      );
    }

    const names =
      votes.get(
        teamId
      );

    const key =
      normalizeText(
        teamName
      );

    const previous =
      names.get(key) ||
      {
        name:
          teamName,

        count:
          0
      };

    previous.count += 1;

    names.set(
      key,
      previous
    );
  }

  return [
    ...votes.entries()
  ]
    .map(
      ([id, names]) => {
        const best =
          [
            ...names.values()
          ].sort(
            (a, b) =>
              b.count -
              a.count
          )[0];

        return {
          id,

          name:
            best?.name ||
            `Equipo ${id}`
        };
      }
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
          'es'
        )
    );
}


function timeline(
  data
) {
  const byDorsal =
    new Map();

  for (
    const e of
    data.equipos || []
  ) {
    for (
      const r of
      e.detalle?.results ||
      []
    ) {
      const d =
        Number(
          r.dorsal
        );

      const s =
        Number(
          r.stage
        );

      const a =
        num(
          r.aggregate_points
        );

      if (
        !byDorsal.has(d)
      ) {
        byDorsal.set(
          d,
          new Map()
        );
      }

      const m =
        byDorsal.get(d);

      if (
        !m.has(s) ||
        a > m.get(s)
      ) {
        m.set(
          s,
          a
        );
      }
    }
  }

  return byDorsal;
}


function aggregateBefore(
  tl,
  dorsal,
  stage
) {
  let bestStage =
    -Infinity;

  let value = 0;

  const m =
    tl.get(
      Number(dorsal)
    );

  if (!m) {
    return 0;
  }

  for (
    const [s, a] of m
  ) {
    if (
      s < stage &&
      s > bestStage
    ) {
      bestStage = s;
      value = a;
    }
  }

  return value;
}


function aggregateAtOrBefore(
  tl,
  dorsal,
  stage
) {
  let bestStage =
    -Infinity;

  let value = 0;

  const m =
    tl.get(
      Number(dorsal)
    );

  if (!m) {
    return 0;
  }

  for (
    const [s, a] of m
  ) {
    if (
      s <= stage &&
      s > bestStage
    ) {
      bestStage = s;
      value = a;
    }
  }

  return value;
}


async function fetchRace(
  raceId
) {
  const res =
    await fetch(
      `${API_BASE}/races/${raceId}/?lang=eu`,
      {
        headers: {
          accept:
            'application/json',

          'user-agent':
            'txami-galdakao-vuelta-2026-updater/5.1'
        }
      }
    );

  if (!res.ok) {
    throw new Error(
      `Tropela carrera ${raceId}: HTTP ${res.status}`
    );
  }

  return res.json();
}


async function fetchStage(
  raceId,
  stageId
) {
  const res =
    await fetch(
      `${API_BASE}/races/${raceId}/stages/${stageId}/points/?aggregate=true`,
      {
        headers: {
          accept:
            'application/json',

          'user-agent':
            'txami-galdakao-vuelta-2026-updater/5.1'
        }
      }
    );

  if (
    res.status === 404
  ) {
    return null;
  }

  if (!res.ok) {
    throw new Error(
      `Tropela ${stageId}: HTTP ${res.status}`
    );
  }

  const data =
    await res.json();

  if (
    !Array.isArray(
      data
    )
  ) {
    throw new Error(
      `Tropela ${stageId}: respuesta inesperada`
    );
  }

  return data;
}


async function discoverVueltaRankingUrls(
  stageNo
) {
  const pageUrl =
    `${VUELTA_BASE}/es/clasificaciones/etapa-${stageNo}`;

  const res =
    await fetch(
      pageUrl,
      {
        headers: {
          accept:
            'text/html,application/xhtml+xml',

          'user-agent':
            'Mozilla/5.0 txami-galdakao-vuelta-2026-updater/5.1'
        }
      }
    );

  if (!res.ok) {
    console.log(
      `La Vuelta etapa ${stageNo}: ` +
      `página de clasificaciones HTTP ${res.status}.`
    );

    return null;
  }

  let html =
    await res.text();

  html = html
    .replace(
      /\\\//g,
      '/'
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#34;/gi,
      '"'
    )
    .replace(
      /&amp;/gi,
      '&'
    );

  const found = {};

  for (
    const [key, code] of
    Object.entries(
      VUELTA_RANKINGS
    )
  ) {
    const match =
      html.match(
        new RegExp(
          `/es/ajax/ranking/${stageNo}/${code}/([a-f0-9]{32})/(?:none|subtab)`,
          'i'
        )
      );

    if (match) {
      found[key] =
        `${VUELTA_BASE}/es/ajax/ranking/` +
        `${stageNo}/${code}/${match[1]}/none`;
    }
  }

  console.log(
    `La Vuelta etapa ${stageNo}: encontradas → ` +
    Object.keys(found)
      .join(', ')
  );

  const missing =
    [
      'individual',
      'points',
      'young',
      'teams'
    ].filter(
      key =>
        !found[key]
    );

  if (
    missing.length
  ) {
    console.log(
      `La Vuelta etapa ${stageNo}: ` +
      `faltan URLs para ${missing.join(', ')}.`
    );

    return null;
  }

  return found;
}


async function fetchVueltaRanking(
  stageNo,
  key,
  urls
) {
  const url =
    urls?.[key];

  if (!url) {
    return null;
  }

  const res =
    await fetch(
      url,
      {
        headers: {
          accept:
            'text/html, */*; q=0.01',

          'user-agent':
            'Mozilla/5.0 txami-galdakao-vuelta-2026-updater/5.1',

          'x-requested-with':
            'XMLHttpRequest',

          referer:
            `${VUELTA_BASE}/es/clasificaciones/etapa-${stageNo}`
        }
      }
    );

  if (
    res.status === 400 ||
    res.status === 404
  ) {
    return null;
  }

  if (!res.ok) {
    throw new Error(
      `La Vuelta ${key} etapa ${stageNo}: HTTP ${res.status}`
    );
  }

  return res.text();
}


async function fetchVueltaClassifications(
  stageNo
) {
  const urls =
    await discoverVueltaRankingUrls(
      stageNo
    );

  if (!urls) {
    return null;
  }

  const entries =
    await Promise.all(
      Object.keys(
        VUELTA_RANKINGS
      ).map(
        async key => [
          key,
          await fetchVueltaRanking(
            stageNo,
            key,
            urls
          )
        ]
      )
    );

  const html =
    Object.fromEntries(
      entries
    );

  if (
    !html.individual ||
    !html.points ||
    !html.young ||
    !html.teams
  ) {
    return null;
  }

  const individual =
    parseRiderRanking(
      html.individual
    );

  const points =
    parseRiderRanking(
      html.points
    );

  const mountain =
    html.mountain
      ? parseRiderRanking(
          html.mountain
        )
      : [];

  const young =
    parseRiderRanking(
      html.young
    );

  const teams =
    parseTeamRanking(
      html.teams
    );

  if (
    individual.length < 25 ||
    points.length < 1 ||
    young.length < 1 ||
    teams.length < 1
  ) {
    console.log(
      `La Vuelta etapa ${stageNo}: ` +
      `clasificaciones todavía incompletas.`
    );

    return null;
  }

  return {
    individual,
    points,
    mountain,
    young,
    teams
  };
}


function apiMap(
  records
) {
  const m =
    new Map();

  for (
    const x of
    records || []
  ) {
    const did =
      Number(
        x?.dorsal?.id
      );

    if (did) {
      m.set(
        did,
        num(
          x.aggregate_points
        )
      );
    }
  }

  return m;
}


function needsReconcile(
  data,
  stageId,
  records
) {
  const api =
    apiMap(records);

  const tl =
    timeline(data);

  for (
    const did of
    selectedDorsals(data)
  ) {
    if (
      api.has(did) &&
      aggregateAtOrBefore(
        tl,
        did,
        stageId
      ) !==
        api.get(did)
    ) {
      return true;
    }
  }

  return false;
}


function rankRows(
  rows,
  valueKey,
  priorKey
) {
  return [
    ...rows
  ].sort(
    (a, b) =>
      num(
        b[valueKey]
      ) -
        num(
          a[valueKey]
        ) ||

      num(
        a[priorKey] ??
        999999
      ) -
        num(
          b[priorKey] ??
          999999
        ) ||

      String(
        a.name
      ).localeCompare(
        String(
          b.name
        ),
        'es'
      )
  );
}


function reconcile(
  data,
  stageId,
  records
) {
  const api =
    apiMap(records);

  let tl =
    timeline(data);

  const before =
    new Map();

  for (
    const did of
    selectedDorsals(data)
  ) {
    before.set(
      did,
      aggregateBefore(
        tl,
        did,
        stageId
      )
    );
  }

  for (
    const e of
    data.equipos || []
  ) {
    const d =
      e.detalle || {};

    d.results =
      (
        d.results ||
        []
      ).filter(
        r =>
          Number(
            r.stage
          ) !==
          stageId
      );

    for (
      const did0 of
      d.dorsal_selection ||
      []
    ) {
      const did =
        Number(did0);

      if (
        !api.has(did)
      ) {
        continue;
      }

      const agg =
        api.get(did);

      d.results.push({
        stage:
          stageId,

        dorsal:
          did,

        points:
          agg -
          num(
            before.get(did)
          ),

        aggregate_points:
          agg
      });
    }

    d.results.sort(
      (a, b) =>
        Number(
          a.stage
        ) -
          Number(
            b.stage
          ) ||

        Number(
          a.dorsal
        ) -
          Number(
            b.dorsal
          )
    );
  }

  tl =
    timeline(data);

  const previousStand =
    new Map();

  for (
    const e of
    data.equipos || []
  ) {
    const prev =
      (
        e.detalle
          ?.standings ||
        []
      )
        .filter(
          s =>
            Number(
              s.stage
            ) <
            stageId
        )
        .sort(
          (a, b) =>
            Number(
              b.stage
            ) -
            Number(
              a.stage
            )
        )[0];

    previousStand.set(
      Number(
        e.porra_id
      ),
      prev
        ?.aggregate_position ??
      999999
    );
  }

  const rows = [];

  for (
    const e of
    data.equipos || []
  ) {
    const ids =
      (
        e.detalle
          ?.dorsal_selection ||
        []
      ).map(Number);

    let stagePoints = 0;
    let aggregatePoints = 0;

    for (
      const did of ids
    ) {
      stagePoints +=
        api.has(did)
          ? api.get(did) -
            num(
              before.get(did)
            )
          : 0;

      aggregatePoints +=
        aggregateAtOrBefore(
          tl,
          did,
          stageId
        );
    }

    rows.push({
      porra:
        Number(
          e.porra_id
        ),

      name:
        e.usuario?.name ||
        e.usuario?.username ||
        '',

      points:
        stagePoints,

      aggregate_points:
        aggregatePoints,

      prior:
        previousStand.get(
          Number(
            e.porra_id
          )
        )
    });
  }

  const stagePos =
    new Map(
      rankRows(
        rows,
        'points',
        'prior'
      ).map(
        (r, i) => [
          r.porra,
          i + 1
        ]
      )
    );

  const aggPos =
    new Map(
      rankRows(
        rows,
        'aggregate_points',
        'prior'
      ).map(
        (r, i) => [
          r.porra,
          i + 1
        ]
      )
    );

  data.standings =
    (
      data.standings ||
      []
    ).filter(
      s =>
        Number(
          s.stage
        ) !==
        stageId
    );

  for (
    const row of rows
  ) {
    const st = {
      stage:
        stageId,

      porra:
        row.porra,

      position:
        stagePos.get(
          row.porra
        ),

      points:
        row.points,

      aggregate_position:
        aggPos.get(
          row.porra
        ),

      aggregate_points:
        row.aggregate_points
    };

    data.standings.push(
      st
    );

    const e =
      data.equipos.find(
        x =>
          Number(
            x.porra_id
          ) ===
          row.porra
      );

    e.detalle.standings =
      (
        e.detalle
          .standings ||
        []
      ).filter(
        s =>
          Number(
            s.stage
          ) !==
          stageId
      );

    const local = {
      ...st
    };

    delete local.porra;

    e.detalle
      .standings
      .push(
        local
      );

    e.detalle
      .standings
      .sort(
        (a, b) =>
          Number(
            a.stage
          ) -
          Number(
            b.stage
          )
      );
  }

  data.standings.sort(
    (a, b) =>
      Number(
        a.stage
      ) -
        Number(
          b.stage
        ) ||

      Number(
        a.aggregate_position
      ) -
        Number(
          b.aggregate_position
        )
  );
}


function raceStagesForPoints(race) {
  const stages =
    (race?.stages || [])
      .filter(
        s =>
          !s?.is_final &&
          !s?.is_canceled &&
          Number(s?.km) > 0
      );

  return stages.length
    ? stages
    : (race?.stages || []);
}

function stageNumberForId(
  race,
  stageId
) {
  // IMPORTANTE:
  // aquí NO quitamos las etapas
  // canceladas, para que la etapa 5
  // siga siendo la etapa 5.
  const stages =
    (
      race?.stages ||
      []
    ).filter(
      s =>
        !s?.is_final
    );

  const idx =
    stages.findIndex(
      s =>
        Number(s.id) ===
        Number(stageId)
    );

  return idx >= 0
    ? idx + 1
    : null;
}


async function updateVueltaMetadata(
  data,
  stageNo
) {
  const cls =
    await fetchVueltaClassifications(
      stageNo
    );

  if (!cls) {
    console.log(
      `La Vuelta etapa ${stageNo}: ` +
      `clasificaciones generales todavía no disponibles.`
    );

    return false;
  }

  const gc =
    cls.individual
      .slice(0, 25)
      .map(
        r =>
          friendlyRiderName(
            data,
            r.name ||
            r.shortName
          )
      );

  const points =
    friendlyRiderName(
      data,
      cls.points[0]?.name ||
      cls.points[0]
        ?.shortName ||
      ''
    );

  const mountain =
    cls.mountain.length
      ? friendlyRiderName(
          data,
          cls.mountain[0]
            ?.name ||
          cls.mountain[0]
            ?.shortName ||
          ''
        )
      : '';

  const young =
    friendlyRiderName(
      data,
      cls.young[0]?.name ||
      cls.young[0]
        ?.shortName ||
      ''
    );

  const teamName =
    cls.teams[0]?.team ||
    '';

  const teamCatalog =
    buildTeamCatalog(
      data,
      cls.individual
    );

  const teamId =
    teamCatalog.find(
      t =>
        normalizeText(
          t.name
        ) ===
        normalizeText(
          teamName
        )
    )?.id ||
    null;

  const previous = {
    current_gc_stage:
      data.metadata
        .current_gc_stage,

    current_gc:
      data.metadata
        .current_gc,

    current_gc_source:
      data.metadata
        .current_gc_source,

    current_specials:
      data.metadata
        .current_specials,

    current_specials_source:
      data.metadata
        .current_specials_source,

    team_catalog:
      data.metadata
        .team_catalog
  };

  data.metadata
    .current_gc_stage =
    stageNo;

  data.metadata
    .current_gc =
    gc;

  data.metadata
    .current_gc_source =
    `La Vuelta oficial · general tras etapa ${stageNo}`;

  data.metadata
    .team_catalog =
    teamCatalog;

  data.metadata
    .current_specials =
    {
      points,
      mountain,
      young,

      basque:
        '',

      team_id:
        teamId ||
        '',

      team_name:
        teamName
    };

  data.metadata
    .current_specials_source =
    `La Vuelta oficial · clasificaciones generales tras etapa ${stageNo}`;

  const next = {
    current_gc_stage:
      data.metadata
        .current_gc_stage,

    current_gc:
      data.metadata
        .current_gc,

    current_gc_source:
      data.metadata
        .current_gc_source,

    current_specials:
      data.metadata
        .current_specials,

    current_specials_source:
      data.metadata
        .current_specials_source,

    team_catalog:
      data.metadata
        .team_catalog
  };

  console.log(
    `La Vuelta etapa ${stageNo}: ` +
    `GC ${gc[0] || '—'} · ` +
    `puntos ${points || '—'} · ` +
    `montaña ${mountain || '—'} · ` +
    `joven ${young || '—'} · ` +
    `equipos ${teamName || '—'} ` +
    `(team_id ${teamId || '—'}).`
  );

  if (
    !teamId &&
    teamName
  ) {
    console.log(
      `Aviso: no pude asociar todavía ` +
      `"${teamName}" con un team_id de Tropela.`
    );
  }

  return !sameJson(
    previous,
    next
  );
}


const data =
  read();

const raceId =
  Number(
    data.metadata
      ?.race_id
  );

if (!raceId) {
  throw new Error(
    'latest.json no contiene metadata.race_id'
  );
}


let current =
  Number(
    data.metadata
      ?.stage_id
  );

if (!current) {
  throw new Error(
    'latest.json no contiene metadata.stage_id'
  );
}


let changed =
  false;


/*
 * Euskaldunak:
 * lo dejamos manual/en blanco.
 */
if (
  data.metadata
    ?.current_specials
    ?.basque
) {
  data.metadata
    .current_specials
    .basque =
    '';

  changed =
    true;
}


/*
 * DATOS GENERALES DE LA CARRERA
 */
const race =
  await fetchRace(
    raceId
  );


/*
 * Guardamos TODAS las etapas,
 * incluida la etapa cancelada.
 *
 * Esto permitirá que la web muestre:
 *
 * Etapa 1
 * Etapa 2
 * Etapa 3 · cancelada
 * Etapa 4
 * Etapa 5
 */
const raceStageMeta =
  (
    race?.stages ||
    []
  )
    .filter(
      s =>
        !s?.is_final
    )
    .map(
      (s, i) => ({
        id:
          Number(
            s.id
          ),

        number:
          i + 1,

        is_canceled:
          !!s.is_canceled,

        has_standings:
          !!s.has_standings,

        start:
          s.start ||
          '',

        finish:
          s.finish ||
          '',

        start_at:
          s.start_at ||
          '',

        end_at:
          s.end_at ||
          ''
      })
    );


if (
  !sameJson(
    data.metadata
      .race_stages,
    raceStageMeta
  )
) {
  data.metadata
    .race_stages =
    raceStageMeta;

  changed =
    true;
}


/*
 * Para actualizar puntos
 * ignoramos las etapas canceladas.
 */
const stages =
  raceStagesForPoints(
    race
  );


const lastWithStandings =
  Number(
    race
      ?.last_stage_with_standings ||
    current
  );


if (
  Number(
    data.metadata
      .tropela_last_stage_with_standings
  ) !==
  lastWithStandings
) {
  data.metadata
    .tropela_last_stage_with_standings =
    lastWithStandings;

  changed =
    true;
}


/*
 * Revisamos la etapa actual por si
 * Tropela ha corregido puntos.
 */
const currentRecords =
  await fetchStage(
    raceId,
    current
  );


if (
  currentRecords &&
  currentRecords.length >=
    MIN_STAGE_RECORDS &&
  needsReconcile(
    data,
    current,
    currentRecords
  )
) {
  reconcile(
    data,
    current,
    currentRecords
  );

  changed =
    true;

  console.log(
    `Tropela stage ${current}: ` +
    `corregido/actualizado ` +
    `(${currentRecords.length} registros).`
  );
}


/*
 * Incorporamos automáticamente
 * las etapas nuevas.
 */
const currentIdx =
  stages.findIndex(
    s =>
      Number(s.id) ===
      current
  );


const lastIdx =
  stages.findIndex(
    s =>
      Number(s.id) ===
      lastWithStandings
  );


if (
  currentIdx >= 0 &&
  lastIdx >
    currentIdx
) {
  for (
    const stage of
    stages.slice(
      currentIdx + 1,
      lastIdx + 1
    )
  ) {
    const stageId =
      Number(
        stage.id
      );

    const records =
      await fetchStage(
        raceId,
        stageId
      );

    if (
      !records ||
      records.length <
        MIN_STAGE_RECORDS
    ) {
      console.log(
        `Tropela stage ${stageId}: ` +
        `todavía no listo ` +
        `(${records?.length ?? '404'} registros).`
      );

      break;
    }

    reconcile(
      data,
      stageId,
      records
    );

    current =
      stageId;

    data.metadata
      .stage_id =
      current;

    changed =
      true;

    console.log(
      `Tropela stage ${stageId}: ` +
      `incorporado ` +
      `(${records.length} registros).`
    );
  }
}


/*
 * Traducimos el stage_id de Tropela
 * al número REAL de etapa de La Vuelta.
 *
 * Aquí sí contamos la etapa cancelada.
 */
const currentStageNo =
  stageNumberForId(
    race,
    Number(
      data.metadata
        .stage_id
    )
  );


if (
  currentStageNo
) {
  if (
    Number(
      data.metadata
        .auto_points_stage
    ) !==
    currentStageNo
  ) {
    data.metadata
      .auto_points_stage =
      currentStageNo;

    changed =
      true;
  }


  /*
   * Actualizamos:
   *
   * - Top 25 general
   * - líder puntos
   * - líder montaña
   * - líder jóvenes
   * - equipo líder
   * - catálogo equipos -> team_id
   */
  if (
    await updateVueltaMetadata(
      data,
      currentStageNo
    )
  ) {
    changed =
      true;
  }

} else {

  console.log(
    `No pude traducir stage_id ` +
    `${data.metadata.stage_id} ` +
    `a número de etapa de La Vuelta.`
  );
}


/*
 * Metadatos finales
 */
data.metadata
  .auto_points =
  true;

data.metadata
  .app_data_version =
  'v15';


/*
 * Solo escribimos latest.json
 * cuando ha cambiado algo.
 */
if (changed) {

  data.metadata
    .descargado_en =
    new Date()
      .toISOString();

  data.metadata
    .auto_updated_at =
    data.metadata
      .descargado_en;

  write(data);

  console.log(
    `latest.json actualizado ` +
    `hasta stage_id ` +
    `${data.metadata.stage_id}.`
  );

} else {

  console.log(
    'Sin cambios; latest.json se mantiene igual.'
  );
}
