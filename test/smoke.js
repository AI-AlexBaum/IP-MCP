#!/usr/bin/env node
/** Smoke test: drives the server over stdio and asserts each tool answers. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

// Fixtures are neutral public records: an EU word mark, a Danish holding's LEI,
// a published VAT number, and one well-known company per national register.
// Nothing project- or customer-specific.
const REQS = [
  { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } },
  { id: 2, method: 'tools/list', params: {} },
  { id: 3, method: 'tools/call', params: { name: 'tm_offices', arguments: {} } },
  { id: 4, method: 'tools/call', params: { name: 'tm_clearance', arguments: { name: 'Northwind', nice_classes: [9, 42] } } },
  { id: 5, method: 'tools/call', params: { name: 'tm_detail', arguments: { number: '000039800' } } },
  { id: 6, method: 'tools/call', params: { name: 'tm_search', arguments: { query: 'Northwind' } } },
  { id: 7, method: 'tools/call', params: { name: 'company_search', arguments: { name: 'KIRKBI', country: 'DK' } } },
  { id: 8, method: 'tools/call', params: { name: 'company_detail', arguments: { lei: '5493005XXPWUMR2E5305' } } },
  { id: 9, method: 'tools/call', params: { name: 'vat_check', arguments: { vat_number: 'DK47458714' } } },
  { id: 10, method: 'tools/call', params: { name: 'vat_check', arguments: { vat_number: 'nonsense' } } },
  { id: 11, method: 'tools/call', params: { name: 'eu_company_sources', arguments: {} } },
  { id: 12, method: 'tools/call', params: { name: 'eu_company_search', arguments: { name: 'Nordic', country: 'CZ', max_results: 3 } } },
  { id: 13, method: 'tools/call', params: { name: 'eu_company_by_number', arguments: { country: 'CZ', number: '00177041' } } },
  { id: 14, method: 'tools/call', params: { name: 'eu_company_search', arguments: { name: 'x', country: 'DE' } } },
  { id: 15, method: 'tools/call', params: { name: 'eu_company_by_number', arguments: { country: 'CH', number: 'CHE-105.909.036' } } },
  { id: 16, method: 'tools/call', params: { name: 'eu_company_search', arguments: { name: 'Ryanair', country: 'IE', max_results: 3 } } },
  { id: 17, method: 'tools/call', params: { name: 'eu_company_by_number', arguments: { country: 'RO', number: '14399840' } } },
  { id: 18, method: 'tools/call', params: { name: 'eu_company_search', arguments: { name: 'Ballut', country: 'MT' } } },
  { id: 19, method: 'tools/call', params: { name: 'eu_company_search', arguments: { name: 'Teltonika', country: 'LT', max_results: 2 } } },
  { id: 20, method: 'tools/call', params: { name: 'eu_company_by_number', arguments: { country: 'SI', number: '5025796000' } } },
  { id: 21, method: 'tools/call', params: { name: 'eu_company_by_number', arguments: { country: 'IT', number: '00159560366' } } },
  { id: 22, method: 'tools/call', params: { name: 'eu_company_search', arguments: { name: 'Nestle', country: 'AT', max_results: 3 } } },
  { id: 23, method: 'tools/call', params: { name: 'eu_company_by_number', arguments: { country: 'LV', number: '40003074590' } } },
];

const payload = (r) => {
  try { return JSON.parse(r.result.content[0].text); } catch { return {}; }
};

const CHECKS = {
  1: (r) => r.result?.serverInfo?.name === 'ip-free-mcp',
  2: (r) => r.result?.tools?.length === 14,
  3: (r) => payload(r).registers?.length > 40,
  4: (r) => typeof payload(r).verdict === 'string' && !r.result?.isError,
  5: (r) => payload(r).mark === 'LEGO' && payload(r).status === 'Registered',
  6: (r) => Array.isArray(payload(r).results) && !r.result?.isError,
  7: (r) => payload(r).results?.some((x) => x.registration_number === '18591235'),
  8: (r) => payload(r).name === 'KIRKBI A/S' && payload(r).children?.length >= 1,
  9: (r) => payload(r).valid === true && payload(r).name === 'Lego System A/S',
  10: (r) => r.result?.isError === true,          // junk input must fail loudly
  11: (r) => payload(r).free_registers?.length === 16
    && payload(r).no_free_api?.length >= 15
    && payload(r).vies_number_to_name?.length === 4,
  12: (r) => payload(r).results?.length <= 3 && payload(r).per_country?.CZ?.in_register > 0,
  13: (r) => payload(r).result?.name?.includes('koda') && payload(r).result?.number === '00177041',
  // A country with no free register must say so, not return an empty list
  14: (r) => r.result?.isError === true && r.result.content[0].text.includes('no free register'),
  // A Swiss UID covers the enterprise and its establishments; both must survive
  15: (r) => payload(r).result?.name === 'Nestl\u00e9 AG'
    && payload(r).result?.commercial_register_number === 'CH17030010013'
    && payload(r).also_under_this_number?.length >= 1,
  16: (r) => payload(r).results?.some((x) => x.name?.startsWith('RYANAIR')),
  17: (r) => payload(r).result?.name === 'DANTE INTERNATIONAL SA'
    && payload(r).result?.company_register_number === 'J2002000372404',
  // MT is number-only: asking by name must explain that, not answer emptily
  18: (r) => r.result?.isError === true
    && r.result.content[0].text.includes('does not support search by name'),
  19: (r) => payload(r).per_country?.LT?.in_register > 0
    && payload(r).results?.every((x) => ['registered', 'deregistered'].includes(x.status)),
  // Slovenia's export has no status column; inventing one would be the bug
  20: (r) => payload(r).result?.name?.startsWith('PETROL') && payload(r).result?.status === null,
  // Where a register is shut but VIES releases the name, say so in the refusal
  21: (r) => r.result?.isError === true && r.result.content[0].text.includes('vat_check'),
  22: (r) => payload(r).results?.some((x) => x.number_type === 'Firmenbuchnummer' && /Nestle/i.test(x.name || '')),
  23: (r) => payload(r).result?.number === '40003074590' && payload(r).result?.status === 'ended',
};

/** Paid tools must refuse loudly when unconfigured — run with the env stripped. */
function configGuard(id) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.COMPANYINFO_USERNAME;
    delete env.COMPANYINFO_PASSWORD;
    const p = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'inherit'], env });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'nl_company_search', arguments: { name: 'Test' } },
    }) + '\n');
    p.stdin.end();
    p.on('close', () => {
      let ok = false;
      try {
        const d = JSON.parse(out.trim().split('\n')[0]);
        const txt = d.result?.content?.[0]?.text || '';
        ok = d.result?.isError === true && txt.includes('COMPANYINFO_USERNAME');
      } catch { /* ok stays false */ }
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${String(id).padEnd(2)}  nl_company_search refuses when unconfigured`);
      resolve(ok);
    });
  });
}

const proc = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'inherit'] });
const seen = new Map();
let buf = '';

proc.stdout.setEncoding('utf8');
proc.stdout.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) { const d = JSON.parse(line); seen.set(d.id, d); }
  }
});

for (const r of REQS) proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...r }) + '\n');
proc.stdin.end();

proc.on('close', async () => {
  let failed = 0;
  for (const r of REQS) {
    const got = seen.get(r.id);
    const arg = r.params?.arguments || {};
    const label = arg.name || arg.vat_number || arg.query || arg.lei || arg.number || '';
    const title = r.params?.name ? `${r.params.name}${label ? ` (${label})` : ''}` : r.method;
    const ok = got && CHECKS[r.id](got);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${String(r.id).padEnd(2)}  ${title}`);
  }
  if (!(await configGuard(REQS.length + 1))) failed++;
  const total = REQS.length + 1;
  console.log(failed ? `\n${failed} of ${total} failed` : `\nall ${total} passed`);
  process.exit(failed ? 1 : 0);
});
