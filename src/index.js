#!/usr/bin/env node
/**
 * ip-free-mcp — trademark research over free, public sources.
 *
 * Sources:
 *   TMview (EUIPO + national offices)  https://www.tmdn.org/tmview/api/search/results
 *   EUIPO eSearch (full case file)     https://euipo.europa.eu/copla/trademark/data/{nr}
 *   GLEIF (company identity, groups)   https://api.gleif.org/api/v1
 *   EU VIES (VAT verification)         https://ec.europa.eu/taxation_customs/vies/rest-api
 *   National registers (8 countries)   see EU_REGISTERS below
 *
 * Optional, paid, credentials via environment only (never committed):
 *   Company.info / Webservices.nl      Dutch Handelsregister — see README
 *
 * Optional, paid, credentials via environment only (never committed):
 *   Company.info / Webservices.nl      Dutch Handelsregister — see README
 *
 * No API keys, no subscription, no per-call billing.
 * Protocol: MCP over stdio, JSON-RPC 2.0. No dependencies.
 */

const PROTOCOL = '2025-06-18';
const NAME = 'ip-free-mcp';
const VERSION = '1.5.0';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const OFFICES = {
  EM: 'EU (EUIPO)', BX: 'Benelux (NL/BE/LU)', AT: 'Austria', BG: 'Bulgaria',
  CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany', DK: 'Denmark', EE: 'Estonia',
  ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'United Kingdom', GR: 'Greece',
  HR: 'Croatia', HU: 'Hungary', IE: 'Ireland', IT: 'Italy', LT: 'Lithuania',
  LV: 'Latvia', MT: 'Malta', PL: 'Poland', PT: 'Portugal', RO: 'Romania',
  SE: 'Sweden', SI: 'Slovenia', SK: 'Slovakia', NO: 'Norway', IS: 'Iceland',
  CH: 'Switzerland', TR: 'Turkey', RS: 'Serbia', MK: 'North Macedonia', AL: 'Albania',
  BA: 'Bosnia and Herzegovina', ME: 'Montenegro', MD: 'Moldova', UA: 'Ukraine',
  LI: 'Liechtenstein', MC: 'Monaco', SM: 'San Marino', GE: 'Georgia', BY: 'Belarus',
  RU: 'Russia', AM: 'Armenia', AZ: 'Azerbaijan', WO: 'WIPO (international)',
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
  mark: t.tmName ?? null,
  register: OFFICES[t.tmOffice] || t.tmOffice || null,
  office: t.tmOffice ?? null,
  status: t.tradeMarkStatus ?? null,
  live: LIVE.has(t.tradeMarkStatus),
  type: t.tradeMarkType ?? null,
  application_date: (t.applicationDate || '').slice(0, 10) || null,
  number: t.applicationNumber ?? null,
  classes: [...(t.niceClass || [])].sort((a, b) => a - b),
  holder: t.applicantName || [],
  case_file: t.tmOfficeURL || null,
});

async function tSearch(a) {
  const q = (a.query || '').trim();
  if (!q) throw new Error('query is required');
  let offices = a.offices || EU_BX;
  if (a.worldwide) offices = [];
  const onlyLive = a.live_only !== false;
  const classes = new Set(a.nice_classes || []);
  const limit = Number(a.max_results) || 50;

  const { recs, total } = await tmview(q, offices);
  let rows = [...recs.values()].map(slim);
  if (onlyLive) rows = rows.filter((r) => r.live);
  if (classes.size) rows = rows.filter((r) => r.classes.some((c) => classes.has(c)));
  const n = norm(q);
  for (const r of rows) r.exact_name = norm(r.mark) === n;
  rows.sort((x, y) =>
    (x.exact_name === y.exact_name ? 0 : x.exact_name ? -1 : 1) ||
    (x.application_date || '9999').localeCompare(y.application_date || '9999'));

  return {
    query: q,
    registers: offices.length ? offices.map((o) => OFFICES[o] || o) : ['all TMview registers'],
    total_raw_hits: total,
    after_filtering: rows.length,
    filters: {
      live_only: onlyLive,
      nice_classes: classes.size ? [...classes].sort((a, b) => a - b) : 'none',
    },
    results: rows.slice(0, limit),
    truncated: Math.max(0, rows.length - limit),
    source: 'TMview (tmdn.org) - free, no key',
  };
}

async function tDetail(a) {
  let nr = String(a.number ?? '').replace(/\D/g, '');
  if (!nr) throw new Error('number is required (EU application number, e.g. 000039800)');
  nr = nr.padStart(9, '0');
  const d = await http(`https://euipo.europa.eu/copla/trademark/data/${nr}`, {
    headers: { Referer: 'https://euipo.europa.eu/eSearch/' },
  });
  const ms = (v) => (typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : null);
  const gs = d.gs?.defaultValue?.values || [];

  return {
    number: d.number ?? null,
    mark: d.name ?? null,
    kind: d.feature ?? null,
    status: d.status ?? null,
    live: LIVE.has(d.status),
    filed: ms(d.filingdate),
    registered: ms(d.regdate),
    valid_until: ms(d.expirydate),
    renewal_status: d.renewalStatus ?? null,
    renewals: (d.renewals || []).map((r) => ({ status: r.status, date: r.statusDate })),
    classes: d.niceclasses ?? null,
    goods_and_services: gs.map((g) => ({ class: g.number, description: g.value })),
    holder: (d.applicants || []).map((x) => ({
      name: x.name,
      address: (x.address?.postalAddress || '').replace(/\n/g, ', '),
    })),
    oppositions: (d.oppositions || []).map((o) => ({
      number: o.number,
      date: ms(o.date),
      status: o.status,
      grounds: (o.grounds || '').trim(),
      opponent: (o.opponents || []).map((x) => x.name),
    })),
    case_file: `https://euipo.europa.eu/eSearch/#details/trademarks/${d.number}`,
    source: 'EUIPO eSearch (copla) - free, no key',
  };
}

async function tClearance(a) {
  const q = (a.name || '').trim();
  if (!q) throw new Error('name is required');
  const classes = new Set(a.nice_classes || [9, 42]);
  const { recs, total } = await tmview(q, EU_BX);
  const rows = [...recs.values()].map(slim);
  const live = rows.filter((r) => r.live);
  const n = norm(q);
  const exactLive = live.filter((r) => norm(r.mark) === n);
  const exactDead = rows.filter((r) => norm(r.mark) === n && !r.live);
  const overlap = live.filter((r) => r.classes.some((c) => classes.has(c)) && norm(r.mark) !== n);
  const benelux = live.filter((r) => r.office === 'BX');

  let verdict;
  if (exactLive.length && exactLive.some((r) => r.classes.some((c) => classes.has(c))))
    verdict = 'TAKEN - identical live mark in your classes';
  else if (exactLive.length) verdict = 'IDENTICAL MARK EXISTS, but in other classes';
  else if (overlap.length) verdict = 'NAME FREE, but live similar rights exist in your classes';
  else verdict = 'FREE - no live identical mark and no class overlap';

  return {
    name: q,
    classes_checked: [...classes].sort((a, b) => a - b),
    registers: ['EU (EUIPO)', 'Benelux (NL/BE/LU)'],
    verdict,
    identical_and_live: exactLive,
    identical_but_expired: exactDead,
    similar_live_in_your_classes: overlap.slice(0, 25),
    live_in_benelux: benelux.slice(0, 15),
    counts: {
      raw: total, live: live.length,
      identical_live: exactLive.length, class_overlap: overlap.length,
    },
    note:
      'Register data, not legal advice. Statuses lag behind the source registers; ' +
      'confirm any live right with tm_detail. A right can also exist unregistered ' +
      '(in the Netherlands, trade name rights arise from use).',
    sources: ['TMview (tmdn.org)', 'EUIPO eSearch (copla)'],
  };
}

async function tOffices() {
  return {
    registers: Object.entries(OFFICES).map(([code, name]) => ({ code, name })),
    default: EU_BX,
    tip: 'Set worldwide=true to search every TMview register instead of EU + Benelux.',
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
    name: e.legalName?.name ?? null,
    also_known_as: (e.otherNames || []).map((n) => n.name).filter(Boolean),
    legal_form_code: e.legalForm?.id ?? null,          // ELF code, 2HBR = GmbH, 54M6 = B.V.
    legal_form_other: e.legalForm?.other ?? null,
    status: e.status ?? null,                          // ACTIVE | INACTIVE
    registration_number: e.registeredAs ?? null,       // national register number
    jurisdiction: e.jurisdiction ?? null,
    address: addr(e.legalAddress),
    headquarters_address: addr(e.headquartersAddress),
    lei_status: a.registration?.status ?? null,        // ISSUED | LAPSED | RETIRED
    lei_updated: (a.registration?.lastUpdateDate || '').slice(0, 10) || null,
    record_url: a.lei ? `https://search.gleif.org/#/record/${a.lei}` : null,
  };
}

const GLEIF_CAVEAT =
  'GLEIF only holds entities that have a LEI. Large companies and anything active in ' +
  'financial markets almost always do; many SMEs do not — an empty result means no LEI, ' +
  'not no company. For Dutch B.V.s without a LEI, try the eu_company_* or nl_company_* ' +
  'tools instead.';

async function tCompanySearch(a) {
  const q = (a.name || '').trim();
  if (!q) throw new Error('name is required');
  const size = Math.min(Number(a.max_results) || 10, 50);
  const p = new URLSearchParams({ 'filter[fulltext]': q, 'page[size]': String(size) });
  if (a.country) p.set('filter[entity.legalAddress.country]', String(a.country).toUpperCase());

  const d = await http(`${GLEIF}/lei-records?${p}`, { headers: JSONAPI });
  const rows = (d.data || []).map(gleifEntity);
  return {
    query: q,
    country: a.country ? String(a.country).toUpperCase() : 'all countries',
    total: d.meta?.pagination?.total ?? rows.length,
    results: rows,
    note: GLEIF_CAVEAT,
    source: 'GLEIF (api.gleif.org) - free, no key',
  };
}

async function tCompanyDetail(a) {
  const lei = String(a.lei || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{20}$/.test(lei)) throw new Error('lei is required: 20 characters, e.g. 5493005XXPWUMR2E5305');

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
  const [parent, top, children] = await Promise.all([
    rel('direct-parent'), rel('ultimate-parent'), rel('direct-children'),
  ]);

  return {
    ...gleifEntity(rec.data),
    direct_parent: parent,
    ultimate_parent: top,
    children,
    group_note:
      'Only relationships where both entities hold a LEI are visible. No parent means ' +
      'either the top of the group, or a parent that holds no LEI.',
    note: GLEIF_CAVEAT,
    source: 'GLEIF (api.gleif.org) - free, no key',
  };
}

// VIES member-state codes. Greece files as EL, not GR; XI is Northern Ireland.
const VIES_MS = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI',
  'SK', 'XI',
]);

async function tVatCheck(a) {
  let s = String(a.vat_number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (a.country && !/^[A-Z]{2}/.test(s)) s = String(a.country).toUpperCase() + s;
  const m = s.match(/^([A-Z]{2})([A-Z0-9]{2,14})$/);
  if (!m) throw new Error('vat_number is required, e.g. NL123456789B01 or DE123456789');
  let [, cc, nr] = m;
  if (cc === 'GR') cc = 'EL';                     // Greece registers VAT as EL
  if (!VIES_MS.has(cc)) {
    throw new Error(
      `"${cc}" is not a VIES member state. VIES covers the EU plus XI ` +
      `(Northern Ireland). Valid codes: ${[...VIES_MS].join(', ')}`);
  }

  const d = await http(
    `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${nr}`,
    { headers: { Accept: 'application/json' } });

  const clean = (v) => (v || '').replace(/\s*\n+\s*/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
  const name = clean(d.name);
  return {
    vat_number: `${cc}${nr}`,
    valid: d.isValid === true,
    name: name && name !== '---' ? name : null,
    address: (() => { const x = clean(d.address); return x && x !== '---' ? x : null; })(),
    checked_on: (d.requestDate || '').slice(0, 10) || null,
    message: d.userError ?? null,
    note:
      'VIES confirms whether a VAT number is valid and returns the name and address as ' +
      'the national tax authority holds them. Some member states do not release name and ' +
      'address; there valid=true but name stays empty. It cannot be searched by name — ' +
      'you need the number up front.',
    source: 'EU VIES (ec.europa.eu) - free, no key',
  };
}


/* ------------------------------------------------------------------ *
 * Dutch Handelsregister via Company.info (Webservices.nl SOAP).
 *
 * OPTIONAL and PAID. Credentials come from the environment only:
 *   COMPANYINFO_USERNAME, COMPANYINFO_PASSWORD, COMPANYINFO_WSDL_URL
 * Never hardcode them — this repository is public. Without them the
 * tools stay listed and explain what to set instead of failing quietly.
 * ------------------------------------------------------------------ */

const CI_ENDPOINT_DEFAULT = 'https://ws1.webservices.nl/soap_doclit.php';
const CI_NS = 'http://www.webservices.nl/soap/';

function ciConfig() {
  const user = process.env.COMPANYINFO_USERNAME;
  const pass = process.env.COMPANYINFO_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'Company.info is not configured. Set COMPANYINFO_USERNAME and ' +
      'COMPANYINFO_PASSWORD in the MCP server environment (COMPANYINFO_WSDL_URL is ' +
      'optional). This is a paid service; every other tool on this server works ' +
      'without it.');
  }
  let url = process.env.COMPANYINFO_WSDL_URL || CI_ENDPOINT_DEFAULT;
  url = url.replace(/\?wsdl$/i, '');
  return { user, pass, url };
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlDecode = (t) =>
  t.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' ? e.slice(2) : e.slice(1), e[1] === 'x' ? 16 : 10));
    return XML_ENT[e] ?? m;
  });
const xmlEscape = (t) =>
  String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/**
 * Minimal XML -> plain object. Namespace prefixes are dropped; a tag that
 * repeats becomes an array. Leaf elements become their decoded text.
 */
function xmlToObj(xml) {
  const root = { kids: {}, text: '' };
  const stack = [root];
  const local = (n) => (n.includes(':') ? n.split(':').pop() : n);
  const attach = (node, name) => {
    const parent = stack[stack.length - 1];
    const value = Object.keys(node.kids).length ? node.kids : xmlDecode(node.text).trim();
    const key = local(name);
    if (key in parent.kids) {
      if (!Array.isArray(parent.kids[key])) parent.kids[key] = [parent.kids[key]];
      parent.kids[key].push(value);
    } else {
      parent.kids[key] = value;
    }
  };
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const [, close, name, , selfClose, text] = m;
    if (text !== undefined) { stack[stack.length - 1].text += text; continue; }
    if (!name) continue;                                  // comment or declaration
    if (close) { attach(stack.pop(), name); continue; }
    if (selfClose) { attach({ kids: {}, text: '' }, name); continue; }
    stack.push({ kids: {}, text: '' });
  }
  return root.kids;
}

/** Always give me a list, whether the parser saw one item or many. */
const arr = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : [v]);

async function soapCall(op, fields) {
  const { user, pass, url } = ciConfig();
  const inner = Object.entries(fields)
    .map(([k, v]) => `<tns:${k}>${xmlEscape(v ?? '')}</tns:${k}>`).join('');
  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="${CI_NS}">` +
    `<soap:Header><tns:HeaderLogin><tns:username>${xmlEscape(user)}</tns:username>` +
    `<tns:password>${xmlEscape(pass)}</tns:password></tns:HeaderLogin></soap:Header>` +
    `<soap:Body><tns:${op}>${inner}</tns:${op}></soap:Body></soap:Envelope>`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `https://ws1.webservices.nl/soap_doclit.php/${op}`,
      'User-Agent': `${NAME}/${VERSION}`,
    },
    body: envelope,
    signal: AbortSignal.timeout(90_000),
  });
  const body = await res.text();
  const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(body);
  if (fault) throw new Error(`Company.info: ${xmlDecode(fault[1]).trim()}`);
  if (!res.ok) throw new Error(`Company.info: HTTP ${res.status}`);

  const parsed = xmlToObj(body);
  const out = parsed?.Envelope?.Body?.[`${op}Response`]?.out;
  if (out === undefined) throw new Error(`Company.info: unexpected response to ${op}`);
  return out;
}

const CI_SOURCE = 'Company.info / Webservices.nl (Dutch Handelsregister) - PAID, per query';

async function tNlSearch(a) {
  const name = (a.name || '').trim();
  if (!name && !a.kvk_number && !a.domain) {
    throw new Error('provide at least one of: name, kvk_number, domain');
  }
  const out = await soapCall('dutchBusinessSearch', {
    dossier_number: a.kvk_number || '',
    trade_name: name,
    city: a.city || '',
    street: '',
    postcode: a.postal_code || '',
    house_number: 0,
    house_number_addition: '',
    telephone_number: '',
    domain_name: a.domain || '',
    strict_search: a.strict === true,
    page: Number(a.page) || 1,
  });
  const paging = out.paging || {};
  return {
    query: name || a.kvk_number || a.domain,
    total: Number(paging.numresults) || 0,
    page: `${paging.curpage || 1} of ${paging.numpages || 1}`,
    results: arr(out.results?.item).map((x) => ({
      kvk_number: x.dossier_number ?? null,
      establishment_number: x.establishment_number ?? null,
      legal_name: x.legal_name ?? null,
      trade_name: x.trade_name ?? null,
      matched_on: x.match_type ?? null,
      city: x.establishment_city ?? null,
      street: x.establishment_street ?? null,
      main_establishment: x.indication_main_establishment === 'true',
    })),
    source: CI_SOURCE,
  };
}

async function tNlProfile(a) {
  const nr = String(a.kvk_number || '').replace(/\D/g, '');
  if (!nr) throw new Error('kvk_number is required (8 digits)');
  const o = await soapCall('dutchBusinessGetDossierV3', {
    dossier_number: nr,
    establishment_number: a.establishment_number || '',
  });
  const addr = (x) => {
    const f = x?.official || x?.original || x || {};
    return [
      [f.street, f.house_number, f.house_number_addition].filter(Boolean).join(' '),
      f.postcode, f.city, f.country,
    ].filter(Boolean).join(', ') || null;
  };
  return {
    kvk_number: o.dossier_number ?? null,
    establishment_number: o.establishment_number ?? null,
    main_establishment: o.indication_main_establishment === 'true',
    legal_name: o.legal_name ?? null,
    trade_name: o.trade_name_full ?? o.trade_name_45 ?? null,
    all_trade_names: arr(o.trade_names?.item),
    legal_form: o.legal_form_text ?? null,
    legal_form_code: o.legal_form_code ?? null,
    rsin: o.rsin_number ?? null,
    establishment_address: addr(o.establishment_address),
    correspondence_address: addr(o.correspondence_address),
    last_updated: o.update_info?.date_last_update ?? null,
    note:
      'For trademark work, all_trade_names is the field that matters: in the Netherlands ' +
      'a trade name right arises from use, with no registration to search.',
    source: CI_SOURCE,
  };
}

async function tNlVat(a) {
  const nr = String(a.kvk_number || '').replace(/\D/g, '');
  if (!nr) throw new Error('kvk_number is required');
  const o = await soapCall('dutchBusinessGetVatNumber', { dossier_number: nr });
  return {
    kvk_number: o.dossier_number ?? null,
    vat_number: o.vat_number || null,
    last_updated: o.date_last_update ?? null,
    tip: 'Feed this number to vat_check to confirm the name for free via EU VIES.',
    source: CI_SOURCE,
  };
}

async function tNlTree(a) {
  const nr = String(a.kvk_number || '').replace(/\D/g, '');
  if (!nr) throw new Error('kvk_number is required');
  const o = await soapCall('dutchBusinessGetOrganizationTree', { dossier_number: nr });
  const walk = (node) => ({
    name: node.name ?? null,
    kind: node.type ?? null,
    kvk_number: /^\d+$/.test(String(node.id || '')) ? node.id : null,
    id: node.id ?? null,
    below: arr(node.children?.item).map(walk),
  });
  const top = o.tree ? walk(o.tree) : null;
  return {
    requested_for: { name: o.name ?? null, kvk_number: o.dossier_number ?? null },
    group: top,
    note:
      'This tree can contain names of natural persons (UBOs, directors). That is ' +
      'personal data under the GDPR: handle it accordingly and do not pass it on more ' +
      'widely than the task needs.',
    source: CI_SOURCE,
  };
}

/* ------------------------------------------------------------------ *
 * National company registers — free, no key, no registration.
 *
 * Every endpoint below was probed live before being included. Countries
 * without a keyless register are listed in EU_NO_FREE_API with the reason,
 * so an empty answer is never mistaken for "no such company".
 * ------------------------------------------------------------------ */


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
    country_name: 'Czechia', register: 'ARES (Ministry of Finance)', id: 'ICO',
    async byName(q, n) {
      const d = await http('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat',
        { body: JSON.stringify({ obchodniJmeno: q, pocet: Math.min(n, 100) }) });
      return { total: d.pocetCelkem ?? 0, rows: arr(d.ekonomickeSubjekty).map(czRow) };
    },
    async byNumber(id) {
      const d = await http(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${encodeURIComponent(id)}`);
      return { total: 1, rows: [czRow(d)] };
    },
  },
  SK: {
    country_name: 'Slovakia', register: 'RPO (Statistical Office)', id: 'ICO',
    async byName(q, n) {
      const d = await http(`https://api.statistics.sk/rpo/v1/search?fullName=${encodeURIComponent(q)}&limit=${Math.min(n, 100)}`);
      return { total: arr(d.results).length, rows: arr(d.results).map(skRow) };
    },
  },
  FI: {
    country_name: 'Finland', register: 'PRH avoindata', id: 'Business ID',
    async byName(q, n) {
      const d = await http(`https://avoindata.prh.fi/opendata-ytj-api/v3/companies?name=${encodeURIComponent(q)}`);
      return { total: d.totalResults ?? arr(d.companies).length, rows: arr(d.companies).slice(0, n).map(fiRow) };
    },
  },
  FR: {
    country_name: 'France', register: 'recherche-entreprises (INSEE/RNE)', id: 'SIREN',
    async byName(q, n) {
      const d = await http(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&per_page=${Math.min(n, 25)}`);
      return { total: d.total_results ?? arr(d.results).length, rows: arr(d.results).map(frRow) };
    },
  },
  NO: {
    country_name: 'Norway', register: 'Bronnoysund Enhetsregisteret', id: 'Organisasjonsnummer',
    async byName(q, n) {
      const d = await http(`https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(q)}&size=${Math.min(n, 100)}`);
      return { total: d.page?.totalElements ?? 0, rows: arr(d._embedded?.enheter).map(noRow) };
    },
  },
  DK: {
    country_name: 'Denmark', register: 'CVR via cvrapi.dk', id: 'CVR number',
    note: 'This source returns only the single best match, not a list.',
    async byName(q) {
      const d = await http(`https://cvrapi.dk/api?search=${encodeURIComponent(q)}&country=dk`,
        { headers: { 'User-Agent': APP_UA } });
      return { total: d?.vat ? 1 : 0, rows: d?.vat ? [dkRow(d)] : [] };
    },
  },
  EE: {
    country_name: 'Estonia', register: 'Ariregister (RIK)', id: 'Registrikood',
    note: 'This source returns name and registration number, no address.',
    async byName(q, n) {
      const d = await http(`https://ariregister.rik.ee/est/api/autocomplete?q=${encodeURIComponent(q)}&results=${Math.min(n, 50)}`);
      return { total: arr(d.data).length, rows: arr(d.data).map(eeRow) };
    },
  },
  PL: {
    country_name: 'Poland', register: 'Wykaz podatnikow VAT (Ministry of Finance)', id: 'NIP or REGON',
    note: 'No name search; by NIP or REGON only, via eu_company_by_number.',
    async byNumber(id) {
      const kind = id.replace(/\D/g, '').length === 9 ? 'regon' : 'nip';
      const d = await http(`https://wl-api.mf.gov.pl/api/search/${kind}/${encodeURIComponent(id.replace(/\D/g, ''))}?date=${today()}`);
      const su = d.result?.subject;
      return { total: su ? 1 : 0, rows: su ? [plRow(su)] : [] };
    },
  },
};

// Countries with no free keyless register, and why. Reported, not hidden.
const EU_NO_FREE_API = {
  AT: 'Firmenbuch is paid', BE: 'KBO is a bulk open-data file or a web form only',
  BG: 'no public API', CH: 'Zefix now requires authentication (HTTP 401)',
  CY: 'no public API', DE: 'Handelsregister has no free API; offeneregister.de is out of service',
  ES: 'Registro Mercantil is paid', GR: 'GEMI requires an API key',
  HR: 'sudreg-api does not respond', HU: 'no public API',
  IE: 'CRO requires API credentials', IS: 'no public API',
  IT: 'Registro Imprese is paid', LT: 'bulk open-data file only',
  LU: 'LBR is paid', LV: 'bulk open-data file only', MT: 'MBR is paid',
  NL: 'KVK requires a subscription; see the nl_company_* tools',
  PT: 'no public API', RO: 'ANAF endpoint not publicly reachable',
  SE: 'Bolagsverket is paid', SI: 'AJPES has no public API',
  UK: 'Companies House is free but requires a (free) API key',
};

const czRow = (r) => ({
  country: 'CZ', name: r.obchodniJmeno ?? null,
  number: r.ico ?? null, number_type: 'ICO',
  status: r.datumZaniku ? 'ended' : 'active',
  legal_form_code: r.pravniForma ?? null,
  founded: r.datumVzniku ?? null,
  address: r.sidlo?.textovaAdresa
    || join(r.sidlo?.nazevUlice, r.sidlo?.cisloDomovni, r.sidlo?.psc, r.sidlo?.nazevObce),
  vat_number: r.dic ?? null,
  source: 'ARES (ares.gov.cz) - free, no key',
});

const skRow = (r) => {
  const a = current(r.addresses);
  return {
    country: 'SK', name: current(r.fullNames)?.value ?? null,
    number: current(r.identifiers)?.value ?? arr(r.identifiers)[0]?.value ?? null,
    number_type: 'ICO',
    status: r.termination ? 'ended' : 'active',
    founded: r.establishment?.date ?? null,
    address: a ? join(a.street, a.buildingNumber, arr(a.postalCodes)[0], a.municipality?.value) : null,
    source: 'RPO (api.statistics.sk) - free, no key',
  };
};

const fiRow = (r) => {
  const a = arr(r.addresses)[0];
  const form = arr(arr(r.companyForms)[0]?.descriptions).find((d) => d.languageCode === '3');
  return {
    country: 'FI', name: arr(r.names)[0]?.name ?? null,
    number: r.businessId?.value ?? r.businessId ?? null, number_type: 'Business ID',
    status: String(r.status) === '2' ? 'active' : `code ${r.status}`,
    legal_form: form?.description ?? null,
    founded: r.registrationDate ?? null,
    address: a ? join(a.street, a.buildingNumber, a.postCode, arr(a.postOffices)[0]?.city) : null,
    website: r.website ?? null,
    source: 'PRH avoindata (avoindata.prh.fi) - free, no key',
  };
};

const frRow = (r) => ({
  country: 'FR', name: r.nom_complet ?? null,
  number: r.siren ?? null, number_type: 'SIREN',
  status: r.etat_administratif === 'A' ? 'active' : 'ended',
  legal_form_code: r.nature_juridique ?? null,
  founded: r.date_creation ?? null,
  address: r.siege?.adresse ?? null,
  vat_number: r.tva ?? null,
  source: 'recherche-entreprises.api.gouv.fr - free, no key',
});

const noRow = (r) => ({
  country: 'NO', name: r.navn ?? null,
  number: r.organisasjonsnummer ?? null, number_type: 'Organisasjonsnummer',
  status: r.konkurs ? 'bankrupt' : r.underAvvikling ? 'in liquidation' : 'active',
  legal_form: r.organisasjonsform?.beskrivelse ?? null,
  founded: r.stiftelsesdato ?? r.registreringsdatoEnhetsregisteret ?? null,
  address: join(arr(r.forretningsadresse?.adresse).join(' '), r.forretningsadresse?.postnummer, r.forretningsadresse?.poststed),
  source: 'Bronnoysund (data.brreg.no) - free, no key',
});

const dkRow = (r) => ({
  country: 'DK', name: r.name ?? null,
  number: r.vat != null ? String(r.vat) : null, number_type: 'CVR number',
  status: r.enddate ? 'ended' : r.creditbankrupt ? 'bankrupt' : 'active',
  legal_form: r.companydesc ?? null,
  founded: r.startdate ?? null,
  address: join(r.address, r.zipcode, r.city),
  activity: r.industrydesc ?? null,
  source: 'CVR via cvrapi.dk - free, no key',
});

const eeRow = (r) => ({
  country: 'EE', name: r.name ?? null,
  number: r.reg_code != null ? String(r.reg_code) : null, number_type: 'Registrikood',
  status: null, address: null,
  source: 'Ariregister (ariregister.rik.ee) - free, no key',
});

const plRow = (s) => ({
  country: 'PL', name: s.name ?? null,
  number: s.nip ?? null, number_type: 'NIP',
  regon: s.regon ?? null,
  status: s.statusVat === 'Czynny' ? 'active (VAT registered)' : (s.statusVat ?? null),
  address: s.workingAddress || s.residenceAddress || null,
  source: 'Wykaz podatnikow VAT (wl-api.mf.gov.pl) - free, no key',
});

const EU_CAVEAT =
  'Every country has its own register, its own fields and its own update cadence. The ' +
  'fields are normalised here; the coverage is not. An empty result means no hit in that ' +
  'one register, not that the company does not exist. See eu_company_sources for which ' +
  'countries have no free API at all.';

async function tEuSearch(a) {
  const q = (a.name || '').trim();
  if (!q) throw new Error('name is required');
  const n = Math.min(Number(a.max_results) || 10, 50);
  const wanted = a.country
    ? [String(a.country).toUpperCase()]
    : Object.keys(EU_REGISTERS).filter((c) => EU_REGISTERS[c].byName);

  const unknown = wanted.filter((c) => !EU_REGISTERS[c]);
  if (unknown.length) {
    const why = unknown.map((c) => `${c}: ${EU_NO_FREE_API[c] || 'unknown country code'}`).join('; ');
    throw new Error(`no free register for ${unknown.join(', ')} — ${why}`);
  }
  const searchable = wanted.filter((c) => EU_REGISTERS[c].byName);
  if (!searchable.length) {
    throw new Error(`${wanted.join(', ')} does not support search by name. ${EU_REGISTERS[wanted[0]]?.note || ''}`.trim());
  }

  const settled = await Promise.all(searchable.map(async (cc) => {
    try {
      const { total, rows } = await EU_REGISTERS[cc].byName(q, n);
      // Some registers ignore their own limit parameter (SK, EE), so the cap is
      // enforced here as well. `total` still reports what the source matched.
      return { cc, total, rows: rows.slice(0, n), truncated: Math.max(0, rows.length - n) };
    } catch (e) {
      return { cc, error: e?.message || String(e) };
    }
  }));

  const results = settled.flatMap((s) => s.rows || []);
  const failed = settled.filter((s) => s.error).map((s) => ({ country: s.cc, error: s.error }));
  return {
    query: q,
    searched: searchable.map((c) => `${c} (${EU_REGISTERS[c].country_name})`),
    hits: results.length,
    per_country: Object.fromEntries(settled.map((s) => [
      s.cc,
      s.error ? 'ERROR' : { in_register: s.total ?? 0, returned: (s.rows || []).length },
    ])),
    results,
    registers_unreachable: failed,
    skipped_no_name_search: wanted.filter((c) => !EU_REGISTERS[c].byName)
      .map((c) => ({ country: c, reason: EU_REGISTERS[c].note })),
    note: EU_CAVEAT,
  };
}

async function tEuByNumber(a) {
  const cc = String(a.country || '').toUpperCase();
  const id = String(a.number || '').trim();
  if (!cc || !id) throw new Error('country and number are both required, e.g. country="CZ", number="00177041"');
  const reg = EU_REGISTERS[cc];
  if (!reg) throw new Error(`no free register for ${cc} — ${EU_NO_FREE_API[cc] || 'unknown country code'}`);
  if (!reg.byNumber) {
    throw new Error(`${cc} (${reg.country_name}) does not support lookup by number in this source; use eu_company_search by name`);
  }
  const { rows } = await reg.byNumber(id);
  return {
    country: cc, register: reg.register, number: id,
    result: rows[0] ?? null,
    note: EU_CAVEAT,
  };
}

async function tEuSources() {
  return {
    free_registers: Object.entries(EU_REGISTERS).map(([cc, r]) => ({
      country: cc, country_name: r.country_name, register: r.register, identifier: r.id,
      by_name: Boolean(r.byName), by_number: Boolean(r.byNumber),
      note: r.note ?? null,
    })),
    no_free_api: Object.entries(EU_NO_FREE_API).map(([cc, reason]) => ({ country: cc, reason })),
    also_available: [
      'vat_check — any EU VAT number, official name and address via VIES',
      'company_search / company_detail — worldwide via GLEIF, LEI holders only',
      'nl_company_* — Dutch Handelsregister, paid, credentials required',
    ],
    note: EU_CAVEAT,
  };
}

const TOOLS = [
  {
    name: 'tm_clearance',
    description:
      'Clearance check on a name in the EU and Benelux registers. Returns a verdict plus ' +
      'three lists: identical live marks, identical expired marks, and live similar ' +
      'rights in your Nice classes. Start here.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name to clear' },
        nice_classes: {
          type: 'array', items: { type: 'integer' },
          description: 'Your classes; defaults to [9, 42] (software and SaaS)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'tm_search',
    description:
      'Search trademarks in TMview. Defaults to EU + Benelux and live rights only. Set ' +
      'worldwide=true to search every national register.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring search on the verbal element' },
        offices: {
          type: 'array', items: { type: 'string' },
          description: 'Register codes, e.g. ["EM","BX","DE"]. Defaults to EU + Benelux.',
        },
        worldwide: { type: 'boolean', description: 'Search every TMview register' },
        live_only: { type: 'boolean', description: 'Defaults to true' },
        nice_classes: { type: 'array', items: { type: 'integer' } },
        max_results: { type: 'integer' },
      },
      required: ['query'],
    },
  },
  {
    name: 'tm_detail',
    description:
      'Full EUIPO case file for an EU application number: status, dates, validity, ' +
      'renewals, holder, oppositions and the complete goods-and-services text per ' +
      'class. EU marks only.',
    inputSchema: {
      type: 'object',
      properties: { number: { type: 'string', description: 'EU application number, e.g. 000039800' } },
      required: ['number'],
    },
  },
  {
    name: 'tm_offices',
    description: 'List the available trademark registers and their codes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'company_search',
    description:
      'Find a company by name in GLEIF: legal form, status, address, national ' +
      'registration number and LEI. Useful for identifying a trademark holder. Covers ' +
      'only entities that hold a LEI — many SMEs do not.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Company name or part of it' },
        country: { type: 'string', description: 'ISO country code to narrow by, e.g. "DE" or "NL"' },
        max_results: { type: 'integer', description: 'Defaults to 10, capped at 50' },
      },
      required: ['name'],
    },
  },
  {
    name: 'company_detail',
    description:
      'Full GLEIF record for a LEI, including group structure: direct parent, ultimate ' +
      'parent and subsidiaries.',
    inputSchema: {
      type: 'object',
      properties: { lei: { type: 'string', description: '20-character LEI, e.g. 5493005XXPWUMR2E5305' } },
      required: ['lei'],
    },
  },
  {
    name: 'vat_check',
    description:
      'Verify an EU VAT number against VIES and get the officially registered name and ' +
      'address back. Confirms a company exists and is active. Cannot be searched by ' +
      'name — you need the number.',
    inputSchema: {
      type: 'object',
      properties: {
        vat_number: { type: 'string', description: 'With country code, e.g. NL123456789B01' },
        country: { type: 'string', description: 'Country code, if not part of vat_number' },
      },
      required: ['vat_number'],
    },
  },
  {
    name: 'eu_company_search',
    description:
      'Search the national company registers of Czechia, Slovakia, Finland, France, ' +
      'Norway, Denmark and Estonia by name. Free, no API key. Omit country to search ' +
      'all seven at once.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Company name or part of it' },
        country: { type: 'string', description: 'ISO country code, e.g. "CZ". Omit to search every register' },
        max_results: { type: 'integer', description: 'Per country, defaults to 10, capped at 50' },
      },
      required: ['name'],
    },
  },
  {
    name: 'eu_company_by_number',
    description:
      'Look a company up by its national registration number. Czechia by ICO, Poland by ' +
      'NIP or REGON — for Poland this is the only route, since it offers no name search.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'ISO country code, e.g. "CZ" or "PL"' },
        number: { type: 'string', description: 'National registration number' },
      },
      required: ['country', 'number'],
    },
  },
  {
    name: 'eu_company_sources',
    description:
      'Which countries have a free register, which identifier each uses, and which ' +
      'countries have none — with the reason. Read this before reading an empty result ' +
      'as "does not exist".',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nl_company_search',
    description:
      'Find a Dutch company in the Handelsregister by trade name, city, postal code or ' +
      'domain, and get its KVK number back. Covers the SMEs that GLEIF misses. PAID: ' +
      'requires Company.info credentials in the environment.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Trade name or part of it' },
        city: { type: 'string' },
        postal_code: { type: 'string' },
        domain: { type: 'string', description: 'Domain name, e.g. example.nl' },
        kvk_number: { type: 'string', description: 'KVK number, if you already have it' },
        strict: { type: 'boolean', description: 'Exact rather than partial match' },
        page: { type: 'integer', description: 'Defaults to 1; 20 results per page' },
      },
    },
  },
  {
    name: 'nl_company_profile',
    description:
      'Full Handelsregister profile for a KVK number: legal name, all trade names, ' +
      'legal form, RSIN and addresses. For trademark work the trade names are the most ' +
      'important field. PAID.',
    inputSchema: {
      type: 'object',
      properties: {
        kvk_number: { type: 'string', description: '8-digit KVK number' },
        establishment_number: { type: 'string', description: 'Optional, for one specific establishment' },
      },
      required: ['kvk_number'],
    },
  },
  {
    name: 'nl_company_vat',
    description:
      'VAT number for a KVK number. Combine with vat_check to confirm the name for free ' +
      'via EU VIES. PAID.',
    inputSchema: {
      type: 'object',
      properties: { kvk_number: { type: 'string' } },
      required: ['kvk_number'],
    },
  },
  {
    name: 'nl_company_tree',
    description:
      'Group structure for a KVK number: parents, subsidiaries and UBO as a tree. Where ' +
      'GLEIF stops because an entity holds no LEI, this keeps going. NOTE: contains ' +
      'personal data. PAID.',
    inputSchema: {
      type: 'object',
      properties: { kvk_number: { type: 'string' } },
      required: ['kvk_number'],
    },
  },
];

const HANDLERS = {
  tm_search: tSearch, tm_detail: tDetail,
  tm_clearance: tClearance, tm_offices: tOffices,
  company_search: tCompanySearch, company_detail: tCompanyDetail, vat_check: tVatCheck,
  nl_company_search: tNlSearch, nl_company_profile: tNlProfile,
  nl_company_vat: tNlVat, nl_company_tree: tNlTree,
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
      if (!fn) throw new Error(`unknown tool: ${p.name}`);
      const out = await fn(p.arguments || {});
      result = { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
    } else {
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method: ${method}` } });
    }
    send({ jsonrpc: '2.0', id, result });
  } catch (e) {
    const msg = e?.message || String(e);
    if (method === 'tools/call') {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `ERROR: ${msg}` }], isError: true } });
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
