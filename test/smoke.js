#!/usr/bin/env node
/** Smoke test: drives the server over stdio and asserts each tool answers. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

const REQS = [
  { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } },
  { id: 2, method: 'tools/list', params: {} },
  { id: 3, method: 'tools/call', params: { name: 'tm_offices', arguments: {} } },
  { id: 4, method: 'tools/call', params: { name: 'tm_clearance', arguments: { naam: 'Northwind', nice_classes: [9, 42] } } },
  { id: 5, method: 'tools/call', params: { name: 'tm_detail', arguments: { nummer: '000039800' } } },
  { id: 6, method: 'tools/call', params: { name: 'tm_search', arguments: { query: 'Northwind' } } },
  { id: 7, method: 'tools/call', params: { name: 'company_search', arguments: { naam: 'KIRKBI', land: 'DK' } } },
  { id: 8, method: 'tools/call', params: { name: 'company_detail', arguments: { lei: '5493005XXPWUMR2E5305' } } },
  { id: 9, method: 'tools/call', params: { name: 'vat_check', arguments: { btw_nummer: 'DK47458714' } } },
  { id: 10, method: 'tools/call', params: { name: 'vat_check', arguments: { btw_nummer: 'onzin' } } },
  { id: 11, method: 'tools/call', params: { name: 'eu_company_sources', arguments: {} } },
  { id: 12, method: 'tools/call', params: { name: 'eu_company_search', arguments: { naam: 'Nordic', land: 'CZ', max_results: 3 } } },
  { id: 13, method: 'tools/call', params: { name: 'eu_company_by_number', arguments: { land: 'CZ', nummer: '00177041' } } },
  { id: 14, method: 'tools/call', params: { name: 'eu_company_search', arguments: { naam: 'x', land: 'DE' } } },
];

const CHECKS = {
  1: (r) => r.result?.serverInfo?.name === 'ip-free-mcp',
  2: (r) => r.result?.tools?.length === 10,
  3: (r) => payload(r).registers?.length > 40,
  4: (r) => typeof payload(r).oordeel === 'string' && !r.result?.isError,
  5: (r) => payload(r).merk === 'LEGO' && payload(r).status === 'Registered',
  6: (r) => Array.isArray(payload(r).resultaten) && !r.result?.isError,
  7: (r) => payload(r).resultaten?.some((x) => x.registratienummer === '18591235'),
  8: (r) => payload(r).naam === 'KIRKBI A/S' && payload(r).dochters?.length >= 1,
  9: (r) => payload(r).geldig === true && payload(r).naam === 'Lego System A/S',
  10: (r) => r.result?.isError === true,          // junk input must fail loudly
  11: (r) => payload(r).gratis_registers?.length === 8 && payload(r).geen_gratis_api?.length > 15,
  12: (r) => payload(r).resultaten?.length <= 3 && payload(r).per_land?.CZ?.in_register > 0,
  13: (r) => payload(r).resultaat?.naam?.includes('koda') && payload(r).resultaat?.nummer === '00177041',
  // A country with no free register must say so, not return an empty list
  14: (r) => r.result?.isError === true && r.result.content[0].text.includes('geen gratis register'),
};

const payload = (r) => {
  try { return JSON.parse(r.result.content[0].text); } catch { return {}; }
};

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

proc.on('close', () => {
  let failed = 0;
  for (const r of REQS) {
    const got = seen.get(r.id);
    const arg = r.params?.arguments || {};
    const label = arg.naam || arg.btw_nummer || arg.query || arg.lei || arg.nummer || '';
    const name = r.params?.name ? `${r.params.name}${label ? ` (${label})` : ''}` : r.method;
    const ok = got && CHECKS[r.id](got);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${r.id}  ${name}`);
  }
  console.log(failed ? `\n${failed} of ${REQS.length} failed` : `\nall ${REQS.length} passed`);
  process.exit(failed ? 1 : 0);
});
