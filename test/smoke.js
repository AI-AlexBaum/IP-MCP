#!/usr/bin/env node
/** Smoke test: drives the server over stdio and asserts each tool answers. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

// Fixtures are neutral public records: an EU word mark, a Danish holding's LEI,
// a published VAT number. Nothing project- or customer-specific.
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
  11: (r) => payload(r).free_registers?.length === 8 && payload(r).no_free_api?.length > 15,
  12: (r) => payload(r).results?.length <= 3 && payload(r).per_country?.CZ?.in_register > 0,
  13: (r) => payload(r).result?.name?.includes('koda') && payload(r).result?.number === '00177041',
  // A country with no free register must say so, not return an empty list
  14: (r) => r.result?.isError === true && r.result.content[0].text.includes('no free register'),
};

/** Paid tools must refuse loudly when unconfigured — run with the env stripped. */
function configGuard() {
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
      console.log(`${ok ? 'ok  ' : 'FAIL'}  15  nl_company_search refuses when unconfigured`);
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
  if (!(await configGuard())) failed++;
  const total = REQS.length + 1;
  console.log(failed ? `\n${failed} of ${total} failed` : `\nall ${total} passed`);
  process.exit(failed ? 1 : 0);
});
