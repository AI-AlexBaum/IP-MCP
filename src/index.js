#!/usr/bin/env node
/**
 * ip-free-mcp — trademark research over free, public sources.
 *
 * Sources:
 *   TMview (EUIPO + national offices)  https://www.tmdn.org/tmview/api/search/results
 *   EUIPO eSearch (full case file)     https://euipo.europa.eu/copla/trademark/data/{nr}
 *   GLEIF (company identity, groups)   https://api.gleif.org/api/v1
 *   EU VIES (VAT verification)         https://ec.europa.eu/taxation_customs/vies/rest-api
 *   National company registers        8 countries, see EU_REGISTERS below
 *
 * No API keys, no subscription, no per-call billing.
 * Protocol: MCP over stdio, JSON-RPC 2.0. No dependencies.
 */

const PROTOCOL = '2025-06-18';
const NAME = 'ip-free-mcp';
const VERSION = '1.4.0';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const OFFICES = {
  EM: 'EU (EUIPO)', BX: 'Benelux (NL/BE/LU)', AT: 'Oostenrijk', BG: 'Bulgarije',
  CY: 'Cyprus', CZ: 'Tsjechie', DE: 'Duitsland', DK: 'Denemarken', EE: 'Estland',
  ES: 'Spanje', FI: 'Finland', FR: 'Frankrijk', GB: 'VK', GR: 'Griekenland',
  HR: 'Kroatie', HU: 'Hongarije', IE: 'Ierland', IT: 'Italie', LT: 'Litouwen',
  LV: 'Letland', MT: 'Malta', PL: 'Polen', PT: 'Portugal', RO: 'Roemenie',
  SE: 'Zweden', SI: 'Slovenie', SK: 'Slowakije', NO: 'Noorwegen', IS: 'IJsland',
  CH: 'Zwitserland', TR: 'Turkije', RS: 'Servie', MK: 'N-Macedonie', AL: 'Albanie',
  BA: 'Bosnie', ME: 'Montenegro', MD: 'Moldavie', UA: 'Oekraine', LI: 'Liechtenstein',
  MC: 'Monaco', SM: 'San Marino', GE: 'Georgie', BY: 'Belarus', RU: 'Rusland',
  AM: 'Armenie', AZ: 'Azerbeidzjan', WO: 'WIPO (internationaal)',
};
const EU_BX = ['EM', 'BX'];

// Statuses that mean a live right. Everything else (Ended, Expired, Withdrawn,
// Refused, Cancelled) is dead and blocks nothing.
const LIVE = new Set([
  'Registered', 'Filed', 'Application published', 'Application accepted',
  'Opposition period', 'Expiring', 'Registration pending',
]);

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, { body, headers } = {}, tries = 3) {
  const hdr = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers };
  if (body !== undefined) hdr['Content-Type'] = 'application/json';
  let last;
  for (let n = 0; n < tries; n++) {
    try {
      const res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: hdr,
        body,
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(await res.text());
    } catch (e) {
      last = e;
      if (n < tries - 1) await sleep(1500 * (n + 1));
    }
  }
  throw new Error(`${url} unreachable after ${tries} attempts: ${last?.message || last}`);
}

/** Search TMview. Returns { recs: Map<ST13, record>, total }. */
async function tmview(query, offices, maxPages = 10) {
  const recs = new Map();
  let page = 1, pages = 1, total = 0;
  while (page <= pages && page <= maxPages) {
    const d = await http('https://www.tmdn.org/tmview/api/search/results', {
      body: JSON.stringify({
        page: String(page), pageSize: '100', criteria: 'C',
        basicSearch: query, fOffices: offices, fTMStatus: [], fNiceClass: [],
      }),
      headers: { Origin: 'https://www.tmdn.org', Referer: 'https://www.tmdn.org/tmview/' },
    });
    pages = d.totalPages || 1;
    total = d.totalResults || 0;
    for (const t of d.tradeMarks || []) recs.set(t.ST13 || t.applicationNumber, t);
    page++;
  }
  return { recs, total };
}

const slim = (t) => ({
  merk: t.tmName ?? null,
  register: OFFICES[t.tmOffice] || t.tmOffice || null,
  office: t.tmOffice ?? null,
  status: t.tradeMarkStatus ?? null,
  levend: LIVE.has(t.tradeMarkStatus),
  type: t.tradeMarkType ?? null,
  aanvraagdatum: (t.applicationDate || '').slice(0, 10) || null,
  nummer: t.applicationNumber ?? null,
  klassen: [...(t.niceClass || [])].sort((a, b) => a - b),
  houder: t.applicantName || [],
  dossier: t.tmOfficeURL || null,
});

async function tSearch(a) {
  const q = (a.query || '').trim();
  if (!q) throw new Error('query is verplicht');
  let offices = a.offices || EU_BX;
  if (a.wereldwijd) offices = [];
  const onlyLive = a.alleen_levend !== false;
  const classes = new Set(a.nice_classes || []);
  const limit = Number(a.max_results) || 50;

  const { recs, total } = await tmview(q, offices);
  let rows = [...recs.values()].map(slim);
  if (onlyLive) rows = rows.filter((r) => r.levend);
  if (classes.size) rows = rows.filter((r) => r.klassen.some((c) => classes.has(c)));
  const n = norm(q);
  for (const r of rows) r.exacte_naam = norm(r.merk) === n;
  rows.sort((x, y) =>
    (x.exacte_naam === y.exacte_naam ? 0 : x.exacte_naam ? -1 : 1) ||
    (x.aanvraagdatum || '9999').localeCompare(y.aanvraagdatum || '9999'));

  return {
    zoekterm: q,
    registers: offices.length ? offices.map((o) => OFFICES[o] || o) : ['alle TMview-registers'],
    treffers_totaal_ruw: total,
    na_filtering: rows.length,
    filters: {
      alleen_levend: onlyLive,
      nice_classes: classes.size ? [...classes].sort((a, b) => a - b) : 'geen',
    },
    resultaten: rows.slice(0, limit),
    afgekapt: Math.max(0, rows.length - limit),
    bron: 'TMview (tmdn.org) - gratis, geen sleutel',
  };
}

async function tDetail(a) {
  let nr = String(a.nummer ?? '').replace(/\D/g, '');
  if (!nr) throw new Error('nummer is verplicht (EU-aanvraagnummer, bijv. 000039800)');
  nr = nr.padStart(9, '0');
  const d = await http(`https://euipo.europa.eu/copla/trademark/data/${nr}`, {
    headers: { Referer: 'https://euipo.europa.eu/eSearch/' },
  });
  const ms = (v) => (typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : null);
  const gs = d.gs?.defaultValue?.values || [];

  return {
    nummer: d.number ?? null,
    merk: d.name ?? null,
    soort: d.feature ?? null,
    status: d.status ?? null,
    levend: LIVE.has(d.status),
    ingediend: ms(d.filingdate),
    geregistreerd: ms(d.regdate),
    geldig_tot: ms(d.expirydate),
    vernieuwingsstatus: d.renewalStatus ?? null,
    vernieuwingen: (d.renewals || []).map((r) => ({ status: r.status, datum: r.statusDate })),
    klassen: d.niceclasses ?? null,
    waren_en_diensten: gs.map((g) => ({ klasse: g.number, omschrijving: g.value })),
    houder: (d.applicants || []).map((x) => ({
      naam: x.name,
      adres: (x.address?.postalAddress || '').replace(/\n/g, ', '),
    })),
    opposities: (d.oppositions || []).map((o) => ({
      nummer: o.number,
      datum: ms(o.date),
      status: o.status,
      grond: (o.grounds || '').trim(),
      opposant: (o.opponents || []).map((x) => x.name),
    })),
    dossier: `https://euipo.europa.eu/eSearch/#details/trademarks/${d.number}`,
    bron: 'EUIPO eSearch (copla) - gratis, geen sleutel',
  };
}

async function tClearance(a) {
  const q = (a.naam || '').trim();
  if (!q) throw new Error('naam is verplicht');
  const classes = new Set(a.nice_classes || [9, 42]);
  const { recs, total } = await tmview(q, EU_BX);
  const rows = [...recs.values()].map(slim);
  const live = rows.filter((r) => r.levend);
  const n = norm(q);
  const exactLive = live.filter((r) => norm(r.merk) === n);
  const exactDead = rows.filter((r) => norm(r.merk) === n && !r.levend);
  const overlap = live.filter((r) => r.klassen.some((c) => classes.has(c)) && norm(r.merk) !== n);
  const benelux = live.filter((r) => r.office === 'BX');

  let oordeel;
  if (exactLive.length && exactLive.some((r) => r.klassen.some((c) => classes.has(c))))
    oordeel = 'BEZET - identiek merk, levend, in jouw klassen';
  else if (exactLive.length) oordeel = 'IDENTIEK MERK BESTAAT, maar in andere klassen';
  else if (overlap.length) oordeel = 'NAAM VRIJ, maar er zijn levende, gelijkende rechten in jouw klassen';
  else oordeel = 'VRIJ - geen levend identiek merk en geen overlap in jouw klassen';

  return {
    naam: q,
    gecheckte_klassen: [...classes].sort((a, b) => a - b),
    registers: ['EU (EUIPO)', 'Benelux (NL/BE/LU)'],
    oordeel,
    identiek_en_levend: exactLive,
    identiek_maar_verlopen: exactDead,
    gelijkend_levend_in_jouw_klassen: overlap.slice(0, 25),
    levend_in_benelux: benelux.slice(0, 15),
    aantallen: {
      ruw: total, levend: live.length,
      identiek_levend: exactLive.length, overlap_in_klassen: overlap.length,
    },
    let_op:
      'Registerdata, geen merkenrechtelijk advies. Statussen lopen achter op de ' +
      'bronregisters; verifieer een levend recht met tm_detail. Een merk kan ook zonder ' +
      'registratie bestaan (handelsnaamrecht door gebruik).',
    bronnen: ['TMview (tmdn.org)', 'EUIPO eSearch (copla)'],
  };
}

async function tOffices() {
  return {
    registers: Object.entries(OFFICES).map(([code, naam]) => ({ code, naam })),
    standaard: EU_BX,
    tip: 'Laat offices leeg met wereldwijd=true voor alle TMview-registers.',
  };
}


/* ------------------------------------------------------------------ *
 * Company lookup — GLEIF and EU VIES. Both public, neither keyed.
 * ------------------------------------------------------------------ */

const GLEIF = 'https://api.gleif.org/api/v1';
const JSONAPI = { Accept: 'application/vnd.api+json' };

/** Flatten one GLEIF lei-record into a readable shape. */
function gleifEntity(x) {
  const a = x?.attributes || {};
  const e = a.entity || {};
  const addr = (o) =>
    [(o?.addressLines || []).join(' '), o?.postalCode, o?.city, o?.country]
      .filter(Boolean).join(', ') || null;
  return {
    lei: a.lei ?? null,
    naam: e.legalName?.name ?? null,
    ook_bekend_als: (e.otherNames || []).map((n) => n.name).filter(Boolean),
    rechtsvorm_code: e.legalForm?.id ?? null,          // ELF code, 2HBR = GmbH, 54M6 = B.V.
    rechtsvorm_vrij: e.legalForm?.other ?? null,
    status: e.status ?? null,                          // ACTIVE | INACTIVE
    registratienummer: e.registeredAs ?? null,         // national register number
    jurisdictie: e.jurisdiction ?? null,
    adres: addr(e.legalAddress),
    hoofdvestiging: addr(e.headquartersAddress),
    lei_status: a.registration?.status ?? null,        // ISSUED | LAPSED | RETIRED
    lei_bijgewerkt: (a.registration?.lastUpdateDate || '').slice(0, 10) || null,
    dossier: a.lei ? `https://search.gleif.org/#/record/${a.lei}` : null,
  };
}

const GLEIF_CAVEAT =
  'GLEIF bevat alleen entiteiten met een LEI. Grote bedrijven en financiele partijen ' +
  'staan er vrijwel altijd in, veel MKB niet — een leeg resultaat betekent geen LEI, ' +
  'niet dat het bedrijf niet bestaat. Voor Nederlandse bv\'s zonder LEI is er geen ' +
  'gratis, sleutelloze bron; gebruik dan het KVK-handelsregister.';

async function tCompanySearch(a) {
  const q = (a.naam || '').trim();
  if (!q) throw new Error('naam is verplicht');
  const size = Math.min(Number(a.max_results) || 10, 50);
  const p = new URLSearchParams({ 'filter[fulltext]': q, 'page[size]': String(size) });
  if (a.land) p.set('filter[entity.legalAddress.country]', String(a.land).toUpperCase());

  const d = await http(`${GLEIF}/lei-records?${p}`, { headers: JSONAPI });
  const rows = (d.data || []).map(gleifEntity);
  return {
    zoekterm: q,
    land: a.land ? String(a.land).toUpperCase() : 'alle landen',
    treffers_totaal: d.meta?.pagination?.total ?? rows.length,
    resultaten: rows,
    let_op: GLEIF_CAVEAT,
    bron: 'GLEIF (api.gleif.org) - gratis, geen sleutel',
  };
}

async function tCompanyDetail(a) {
  const lei = String(a.lei || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{20}$/.test(lei)) throw new Error('lei is verplicht: 20 tekens, bijv. 5493005XXPWUMR2E5305');

  const rec = await http(`${GLEIF}/lei-records/${lei}`, { headers: JSONAPI });
  const rel = async (kind) => {
    try {
      const d = await http(`${GLEIF}/lei-records/${lei}/${kind}`, { headers: JSONAPI }, 1);
      const dd = d.data;
      if (!dd) return [];
      return (Array.isArray(dd) ? dd : [dd]).map(gleifEntity);
    } catch {
      return [];   // no such relationship is a 404, not an error worth surfacing
    }
  };
  const [moeder, top, dochters] = await Promise.all([
    rel('direct-parent'), rel('ultimate-parent'), rel('direct-children'),
  ]);

  return {
    ...gleifEntity(rec.data),
    directe_moeder: moeder,
    uiteindelijke_moeder: top,
    dochters,
    concern_let_op:
      'Alleen relaties tussen entiteiten die beide een LEI hebben zijn zichtbaar. ' +
      'Geen moeder betekent: top van het concern, of de moeder heeft geen LEI.',
    let_op: GLEIF_CAVEAT,
    bron: 'GLEIF (api.gleif.org) - gratis, geen sleutel',
  };
}

// VIES member-state codes. Greece files as EL, not GR; XI is Northern Ireland.
const VIES_MS = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI',
  'SK', 'XI',
]);

async function tVatCheck(a) {
  let s = String(a.btw_nummer ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (a.land && !/^[A-Z]{2}/.test(s)) s = String(a.land).toUpperCase() + s;
  const m = s.match(/^([A-Z]{2})([A-Z0-9]{2,14})$/);
  if (!m) throw new Error('btw_nummer is verplicht, bijv. NL123456789B01 of DE123456789');
  let [, land, nr] = m;
  if (land === 'GR') land = 'EL';                 // Greece registers VAT as EL
  if (!VIES_MS.has(land)) {
    throw new Error(
      `"${land}" is geen VIES-lidstaat. VIES dekt alleen de EU plus XI ` +
      `(Noord-Ierland). Geldige codes: ${[...VIES_MS].join(', ')}`);
  }

  const d = await http(
    `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${land}/vat/${nr}`,
    { headers: { Accept: 'application/json' } });

  const clean = (v) => (v || '').replace(/\s*\n+\s*/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
  const naam = clean(d.name);
  return {
    btw_nummer: `${land}${nr}`,
    geldig: d.isValid === true,
    naam: naam && naam !== '---' ? naam : null,
    adres: (() => { const x = clean(d.address); return x && x !== '---' ? x : null; })(),
    gecontroleerd_op: (d.requestDate || '').slice(0, 10) || null,
    melding: d.userError ?? null,
    let_op:
      'VIES bevestigt of een btw-nummer geldig is en geeft de naam en het adres zoals ' +
      'de nationale belastingdienst die registreert. Sommige lidstaten geven naam en ' +
      'adres niet vrij; dan is geldig=true maar blijft naam leeg. Zoeken op naam kan ' +
      'niet — je moet het nummer al hebben.',
    bron: 'EU VIES (ec.europa.eu) - gratis, geen sleutel',
  };
}


/* ------------------------------------------------------------------ *
 * National company registers — free, no key, no registration.
 *
 * Every endpoint below was probed live before being included. Countries
 * without a keyless register are listed in EU_NO_FREE_API with the reason,
 * so an empty answer is never mistaken for "no such company".
 * ------------------------------------------------------------------ */

/** Always give me a list, whether the source sent one item, many, or nothing. */
const arr = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]);

const APP_UA = `ip-free-mcp/${VERSION} (+https://github.com/AI-AlexBaum/IP-MCP)`;
const today = () => new Date().toISOString().slice(0, 10);
const join = (...parts) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || null;

/** Pick the entry that has no end date — the currently valid one. */
const current = (list, endKey = 'validTo') => {
  const a = arr(list);
  return a.find((x) => !x?.[endKey]) || a[a.length - 1] || null;
};

const EU_REGISTERS = {
  CZ: {
    land: 'Tsjechie', register: 'ARES (Ministerie van Financien)', id: 'ICO',
    async byName(q, n) {
      const d = await http('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat',
        { body: JSON.stringify({ obchodniJmeno: q, pocet: Math.min(n, 100) }) });
      return { totaal: d.pocetCelkem ?? 0, rows: arr(d.ekonomickeSubjekty).map(czRow) };
    },
    async byNumber(id) {
      const d = await http(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${encodeURIComponent(id)}`);
      return { totaal: 1, rows: [czRow(d)] };
    },
  },
  SK: {
    land: 'Slowakije', register: 'RPO (Statistisch Bureau)', id: 'ICO',
    async byName(q, n) {
      const d = await http(`https://api.statistics.sk/rpo/v1/search?fullName=${encodeURIComponent(q)}&limit=${Math.min(n, 100)}`);
      return { totaal: arr(d.results).length, rows: arr(d.results).map(skRow) };
    },
  },
  FI: {
    land: 'Finland', register: 'PRH avoindata', id: 'Business ID',
    async byName(q, n) {
      const d = await http(`https://avoindata.prh.fi/opendata-ytj-api/v3/companies?name=${encodeURIComponent(q)}`);
      return { totaal: d.totalResults ?? arr(d.companies).length, rows: arr(d.companies).slice(0, n).map(fiRow) };
    },
  },
  FR: {
    land: 'Frankrijk', register: 'recherche-entreprises (INSEE/RNE)', id: 'SIREN',
    async byName(q, n) {
      const d = await http(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=${Math.min(n, 25)}`);
      return { totaal: d.total_results ?? arr(d.results).length, rows: arr(d.results).map(frRow) };
    },
  },
  NO: {
    land: 'Noorwegen', register: 'Bronnoysund Enhetsregisteret', id: 'Organisasjonsnummer',
    async byName(q, n) {
      const d = await http(`https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(q)}&size=${Math.min(n, 100)}`);
      return { totaal: d.page?.totalElements ?? 0, rows: arr(d._embedded?.enheter).map(noRow) };
    },
  },
  DK: {
    land: 'Denemarken', register: 'CVR via cvrapi.dk', id: 'CVR-nummer',
    note: 'Deze bron geeft alleen de beste treffer terug, geen lijst.',
    async byName(q) {
      const d = await http(`https://cvrapi.dk/api?search=${encodeURIComponent(q)}&country=dk`,
        { headers: { 'User-Agent': APP_UA } });
      return { totaal: d?.vat ? 1 : 0, rows: d?.vat ? [dkRow(d)] : [] };
    },
  },
  EE: {
    land: 'Estland', register: 'Ariregister (RIK)', id: 'Registrikood',
    note: 'Deze bron geeft naam en registratienummer, geen adres.',
    async byName(q, n) {
      const d = await http(`https://ariregister.rik.ee/est/api/autocomplete?q=${encodeURIComponent(q)}&results=${Math.min(n, 50)}`);
      return { totaal: arr(d.data).length, rows: arr(d.data).map(eeRow) };
    },
  },
  PL: {
    land: 'Polen', register: 'Wykaz podatnikow VAT (Ministerie van Financien)', id: 'NIP of REGON',
    note: 'Zoeken op naam kan niet; alleen op NIP of REGON via eu_company_by_number.',
    async byNumber(id) {
      const kind = id.replace(/\D/g, '').length === 9 ? 'regon' : 'nip';
      const d = await http(`https://wl-api.mf.gov.pl/api/search/${kind}/${encodeURIComponent(id.replace(/\D/g, ''))}?date=${today()}`);
      const su = d.result?.subject;
      return { totaal: su ? 1 : 0, rows: su ? [plRow(su)] : [] };
    },
  },
};

// Countries with no free keyless register, and why. Reported, not hidden.
const EU_NO_FREE_API = {
  AT: 'Firmenbuch is betaald', BE: 'KBO alleen als open-databestand of webformulier',
  BG: 'geen publieke API', CH: 'Zefix vereist sinds kort authenticatie (HTTP 401)',
  CY: 'geen publieke API', DE: 'Handelsregister heeft geen gratis API; offeneregister.de is buiten dienst',
  ES: 'Registro Mercantil is betaald', GR: 'GEMI vereist een sleutel',
  HR: 'sudreg-api reageert niet', HU: 'geen publieke API',
  IE: 'CRO vereist API-credentials', IS: 'geen publieke API',
  IT: 'Registro Imprese is betaald', LT: 'alleen als open-databestand',
  LU: 'LBR is betaald', LV: 'alleen als open-databestand', MT: 'MBR is betaald',
  NL: 'KVK vereist een abonnement; zie de nl_company_* tools',
  PT: 'geen publieke API', RO: 'ANAF-endpoint niet publiek bereikbaar',
  SE: 'Bolagsverket is betaald', SI: 'AJPES heeft geen publieke API',
  UK: 'Companies House is gratis maar vereist een (gratis) API-sleutel',
};

const czRow = (r) => ({
  land: 'CZ', naam: r.obchodniJmeno ?? null,
  nummer: r.ico ?? null, nummer_soort: 'ICO',
  status: r.datumZaniku ? 'beeindigd' : 'actief',
  rechtsvorm_code: r.pravniForma ?? null,
  opgericht: r.datumVzniku ?? null,
  adres: r.sidlo?.textovaAdresa
    || join(r.sidlo?.nazevUlice, r.sidlo?.cisloDomovni, r.sidlo?.psc, r.sidlo?.nazevObce),
  btw_nummer: r.dic ?? null,
  bron: 'ARES (ares.gov.cz) - gratis, geen sleutel',
});

const skRow = (r) => {
  const a = current(r.addresses);
  return {
    land: 'SK', naam: current(r.fullNames)?.value ?? null,
    nummer: current(r.identifiers)?.value ?? arr(r.identifiers)[0]?.value ?? null,
    nummer_soort: 'ICO',
    status: r.termination ? 'beeindigd' : 'actief',
    opgericht: r.establishment?.date ?? null,
    adres: a ? join(a.street, a.buildingNumber, arr(a.postalCodes)[0], a.municipality?.value) : null,
    bron: 'RPO (api.statistics.sk) - gratis, geen sleutel',
  };
};

const fiRow = (r) => {
  const a = arr(r.addresses)[0];
  const form = arr(arr(r.companyForms)[0]?.descriptions).find((d) => d.languageCode === '3');
  return {
    land: 'FI', naam: arr(r.names)[0]?.name ?? null,
    nummer: r.businessId?.value ?? r.businessId ?? null, nummer_soort: 'Business ID',
    status: String(r.status) === '2' ? 'actief' : `code ${r.status}`,
    rechtsvorm: form?.description ?? null,
    opgericht: r.registrationDate ?? null,
    adres: a ? join(a.street, a.buildingNumber, a.postCode, arr(a.postOffices)[0]?.city) : null,
    website: r.website ?? null,
    bron: 'PRH avoindata (avoindata.prh.fi) - gratis, geen sleutel',
  };
};

const frRow = (r) => ({
  land: 'FR', naam: r.nom_complet ?? null,
  nummer: r.siren ?? null, nummer_soort: 'SIREN',
  status: r.etat_administratif === 'A' ? 'actief' : 'beeindigd',
  rechtsvorm_code: r.nature_juridique ?? null,
  opgericht: r.date_creation ?? null,
  adres: r.siege?.adresse ?? null,
  btw_nummer: r.tva ?? null,
  bron: 'recherche-entreprises.api.gouv.fr - gratis, geen sleutel',
});

const noRow = (r) => ({
  land: 'NO', naam: r.navn ?? null,
  nummer: r.organisasjonsnummer ?? null, nummer_soort: 'Organisasjonsnummer',
  status: r.konkurs ? 'faillissement' : r.underAvvikling ? 'in liquidatie' : 'actief',
  rechtsvorm: r.organisasjonsform?.beskrivelse ?? null,
  opgericht: r.stiftelsesdato ?? r.registreringsdatoEnhetsregisteret ?? null,
  adres: join(arr(r.forretningsadresse?.adresse).join(' '), r.forretningsadresse?.postnummer, r.forretningsadresse?.poststed),
  bron: 'Bronnoysund (data.brreg.no) - gratis, geen sleutel',
});

const dkRow = (r) => ({
  land: 'DK', naam: r.name ?? null,
  nummer: r.vat != null ? String(r.vat) : null, nummer_soort: 'CVR-nummer',
  status: r.enddate ? 'beeindigd' : r.creditbankrupt ? 'faillissement' : 'actief',
  rechtsvorm: r.companydesc ?? null,
  opgericht: r.startdate ?? null,
  adres: join(r.address, r.zipcode, r.city),
  activiteit: r.industrydesc ?? null,
  bron: 'CVR via cvrapi.dk - gratis, geen sleutel',
});

const eeRow = (r) => ({
  land: 'EE', naam: r.name ?? null,
  nummer: r.reg_code != null ? String(r.reg_code) : null, nummer_soort: 'Registrikood',
  status: null, adres: null,
  bron: 'Ariregister (ariregister.rik.ee) - gratis, geen sleutel',
});

const plRow = (s) => ({
  land: 'PL', naam: s.name ?? null,
  nummer: s.nip ?? null, nummer_soort: 'NIP',
  regon: s.regon ?? null,
  status: s.statusVat === 'Czynny' ? 'actief (btw-plichtig)' : (s.statusVat ?? null),
  adres: s.workingAddress || s.residenceAddress || null,
  bron: 'Wykaz podatnikow VAT (wl-api.mf.gov.pl) - gratis, geen sleutel',
});

const EU_CAVEAT =
  'Elk land heeft zijn eigen register met eigen velden en eigen actualiteit; de velden ' +
  'zijn hier gelijkgetrokken, de brondekking niet. Een leeg resultaat betekent geen ' +
  'treffer in dat ene register, niet dat het bedrijf niet bestaat. Zie eu_company_sources ' +
  'voor welke landen geen gratis API hebben.';

async function tEuSearch(a) {
  const q = (a.naam || '').trim();
  if (!q) throw new Error('naam is verplicht');
  const n = Math.min(Number(a.max_results) || 10, 50);
  const wanted = a.land
    ? [String(a.land).toUpperCase()]
    : Object.keys(EU_REGISTERS).filter((c) => EU_REGISTERS[c].byName);

  const unknown = wanted.filter((c) => !EU_REGISTERS[c]);
  if (unknown.length) {
    const why = unknown.map((c) => `${c}: ${EU_NO_FREE_API[c] || 'onbekende landcode'}`).join('; ');
    throw new Error(`geen gratis register voor ${unknown.join(', ')} — ${why}`);
  }
  const searchable = wanted.filter((c) => EU_REGISTERS[c].byName);
  if (!searchable.length) {
    throw new Error(`${wanted.join(', ')} ondersteunt geen zoeken op naam. ${EU_REGISTERS[wanted[0]]?.note || ''}`.trim());
  }

  const settled = await Promise.all(searchable.map(async (cc) => {
    try {
      const { totaal, rows } = await EU_REGISTERS[cc].byName(q, n);
      // Some registers ignore their own limit parameter (SK, EE), so the cap is
      // enforced here as well. totaal still reports what the source matched.
      return { cc, totaal, rows: rows.slice(0, n), afgekapt: Math.max(0, rows.length - n) };
    } catch (e) {
      return { cc, fout: e?.message || String(e) };
    }
  }));

  const resultaten = settled.flatMap((s) => s.rows || []);
  const mislukt = settled.filter((s) => s.fout).map((s) => ({ land: s.cc, fout: s.fout }));
  return {
    zoekterm: q,
    gezocht_in: searchable.map((c) => `${c} (${EU_REGISTERS[c].land})`),
    treffers: resultaten.length,
    per_land: Object.fromEntries(settled.map((s) => [
      s.cc,
      s.fout ? 'FOUT' : { in_register: s.totaal ?? 0, geleverd: (s.rows || []).length },
    ])),
    resultaten,
    registers_niet_bereikbaar: mislukt,
    overgeslagen_geen_naamzoeken: wanted.filter((c) => !EU_REGISTERS[c].byName)
      .map((c) => ({ land: c, reden: EU_REGISTERS[c].note })),
    let_op: EU_CAVEAT,
  };
}

async function tEuByNumber(a) {
  const cc = String(a.land || '').toUpperCase();
  const id = String(a.nummer || '').trim();
  if (!cc || !id) throw new Error('land en nummer zijn beide verplicht, bijv. land="CZ", nummer="00177041"');
  const reg = EU_REGISTERS[cc];
  if (!reg) throw new Error(`geen gratis register voor ${cc} — ${EU_NO_FREE_API[cc] || 'onbekende landcode'}`);
  if (!reg.byNumber) {
    throw new Error(`${cc} (${reg.land}) ondersteunt opzoeken op nummer niet in deze bron; gebruik eu_company_search op naam`);
  }
  const { rows } = await reg.byNumber(id);
  return {
    land: cc, register: reg.register, gezocht_nummer: id,
    resultaat: rows[0] ?? null,
    let_op: EU_CAVEAT,
  };
}

async function tEuSources() {
  return {
    gratis_registers: Object.entries(EU_REGISTERS).map(([cc, r]) => ({
      land: cc, naam: r.land, register: r.register, identifier: r.id,
      zoeken_op_naam: Boolean(r.byName), opzoeken_op_nummer: Boolean(r.byNumber),
      opmerking: r.note ?? null,
    })),
    geen_gratis_api: Object.entries(EU_NO_FREE_API).map(([cc, reden]) => ({ land: cc, reden })),
    aanvullend: [
      'vat_check — elk EU-btw-nummer, officiele naam en adres via VIES',
      'company_search / company_detail — wereldwijd via GLEIF, alleen partijen met een LEI',
      'nl_company_* — Nederlands Handelsregister, betaald, credentials vereist',
    ],
    let_op: EU_CAVEAT,
  };
}

const TOOLS = [
  {
    name: 'tm_clearance',
    description:
      'Merkcheck op een naam in EU en Benelux. Geeft een oordeel plus drie lijsten: ' +
      'identieke levende merken, identieke verlopen merken, en levende gelijkende ' +
      'rechten in jouw Nice-klassen. Begin hiermee.',
    inputSchema: {
      type: 'object',
      properties: {
        naam: { type: 'string', description: 'De naam die je wilt checken' },
        nice_classes: {
          type: 'array', items: { type: 'integer' },
          description: 'Jouw klassen, standaard [9, 42] (software en SaaS)',
        },
      },
      required: ['naam'],
    },
  },
  {
    name: 'tm_search',
    description:
      'Zoek merken in TMview. Standaard EU + Benelux en alleen levende rechten. ' +
      'Zet wereldwijd=true voor alle nationale registers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        offices: {
          type: 'array', items: { type: 'string' },
          description: 'Registercodes, bijv. ["EM","BX","DE"]. Standaard EU+Benelux.',
        },
        wereldwijd: { type: 'boolean', description: 'Alle TMview-registers' },
        alleen_levend: { type: 'boolean', description: 'Standaard true' },
        nice_classes: { type: 'array', items: { type: 'integer' } },
        max_results: { type: 'integer' },
      },
      required: ['query'],
    },
  },
  {
    name: 'tm_detail',
    description:
      'Volledig EUIPO-dossier bij een EU-aanvraagnummer: status, data, geldigheidsduur, ' +
      'vernieuwingen, houder, opposities en de complete waren- en dienstenlijst per ' +
      'klasse. Alleen EU-merken.',
    inputSchema: {
      type: 'object',
      properties: { nummer: { type: 'string', description: 'EU-aanvraagnummer, bijv. 000039800' } },
      required: ['nummer'],
    },
  },
  {
    name: 'tm_offices',
    description: 'Lijst met beschikbare registers en hun codes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'company_search',
    description:
      'Zoek een bedrijf op naam in GLEIF: rechtsvorm, status, adres, nationaal ' +
      'registratienummer en LEI. Handig om een merkhouder te identificeren. Alleen ' +
      'entiteiten met een LEI — veel MKB staat er niet in.',
    inputSchema: {
      type: 'object',
      properties: {
        naam: { type: 'string', description: 'Bedrijfsnaam of deel daarvan' },
        land: { type: 'string', description: 'ISO-landcode om op te filteren, bijv. "DE" of "NL"' },
        max_results: { type: 'integer', description: 'Standaard 10, maximaal 50' },
      },
      required: ['naam'],
    },
  },
  {
    name: 'company_detail',
    description:
      'Volledig GLEIF-dossier bij een LEI, inclusief concernstructuur: directe moeder, ' +
      'uiteindelijke moeder en dochterondernemingen.',
    inputSchema: {
      type: 'object',
      properties: { lei: { type: 'string', description: 'LEI van 20 tekens, bijv. 5493005XXPWUMR2E5305' } },
      required: ['lei'],
    },
  },
  {
    name: 'vat_check',
    description:
      'Verifieer een EU-btw-nummer bij VIES en krijg de officiele naam en het adres ' +
      'terug. Bevestigt of een bedrijf echt bestaat en actief is. Zoeken op naam kan ' +
      'niet — je hebt het nummer nodig.',
    inputSchema: {
      type: 'object',
      properties: {
        btw_nummer: { type: 'string', description: 'Met landcode, bijv. NL123456789B01' },
        land: { type: 'string', description: 'Landcode, als die niet in btw_nummer zit' },
      },
      required: ['btw_nummer'],
    },
  },
  {
    name: 'eu_company_search',
    description:
      'Zoek een bedrijf op naam in de nationale handelsregisters van Tsjechie, ' +
      'Slowakije, Finland, Frankrijk, Noorwegen, Denemarken en Estland. Gratis, geen ' +
      'sleutel. Laat land weg om alle zeven tegelijk te zoeken.',
    inputSchema: {
      type: 'object',
      properties: {
        naam: { type: 'string', description: 'Bedrijfsnaam of deel daarvan' },
        land: { type: 'string', description: 'ISO-landcode, bijv. "CZ". Weglaten = alle landen tegelijk' },
        max_results: { type: 'integer', description: 'Per land, standaard 10, maximaal 50' },
      },
      required: ['naam'],
    },
  },
  {
    name: 'eu_company_by_number',
    description:
      'Zoek een bedrijf op zijn nationale registratienummer. Tsjechie op ICO, Polen op ' +
      'NIP of REGON — bij Polen is dit de enige route, want zoeken op naam kan daar niet.',
    inputSchema: {
      type: 'object',
      properties: {
        land: { type: 'string', description: 'ISO-landcode, bijv. "CZ" of "PL"' },
        nummer: { type: 'string', description: 'Nationaal registratienummer' },
      },
      required: ['land', 'nummer'],
    },
  },
  {
    name: 'eu_company_sources',
    description:
      'Welke landen hebben een gratis register, welke identifier hoort erbij, en welke ' +
      'landen hebben er geen — met de reden. Lees dit voordat je een leeg resultaat als ' +
      '"bestaat niet" uitlegt.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const HANDLERS = {
  tm_search: tSearch, tm_detail: tDetail,
  tm_clearance: tClearance, tm_offices: tOffices,
  company_search: tCompanySearch, company_detail: tCompanyDetail, vat_check: tVatCheck,
  eu_company_search: tEuSearch, eu_company_by_number: tEuByNumber,
  eu_company_sources: tEuSources,
};

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

async function handle(req) {
  const { id, method } = req;
  if (id === undefined || id === null) return;   // notification: no reply
  try {
    let result;
    if (method === 'initialize') {
      result = {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: NAME, version: VERSION },
      };
    } else if (method === 'tools/list') {
      result = { tools: TOOLS };
    } else if (method === 'ping') {
      result = {};
    } else if (method === 'tools/call') {
      const p = req.params || {};
      const fn = HANDLERS[p.name];
      if (!fn) throw new Error(`onbekende tool: ${p.name}`);
      const out = await fn(p.arguments || {});
      result = { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } else {
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `onbekende methode: ${method}` } });
    }
    send({ jsonrpc: '2.0', id, result });
  } catch (e) {
    const msg = e?.message || String(e);
    if (method === 'tools/call') {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `FOUT: ${msg}` }], isError: true } });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: msg } });
    }
  }
}

// Requests are handled concurrently, but the process must not exit while any
// are still in flight — a client that closes stdin mid-call would otherwise
// lose the pending replies.
const inflight = new Set();
let stdinEnded = false;

function dispatch(req) {
  const p = handle(req).finally(() => {
    inflight.delete(p);
    if (stdinEnded && inflight.size === 0) process.exit(0);
  });
  inflight.add(p);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    dispatch(req);
  }
});
process.stdin.on('end', () => {
  stdinEnded = true;
  if (inflight.size === 0) process.exit(0);
});
