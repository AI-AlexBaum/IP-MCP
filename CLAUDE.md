# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server for trademark and company research over public registers. One file, zero
dependencies, Node 18+, ESM. It speaks MCP over stdio with a hand-rolled JSON-RPC loop —
there is no SDK, no build step and no bundler.

Distribution is `npx -y github:AI-AlexBaum/IP-MCP`, straight from the repo. Nothing is
published to npm, so `package.json`'s `bin` and `files` must stay correct or the install
path silently breaks.

## Commands

```bash
npm run smoke              # the entire test suite (15 checks, hits live registers)
node --check src/index.js  # syntax gate
node src/index.js          # speaks MCP on stdin/stdout
```

To run a single check, pipe one JSON-RPC line in — this is the fastest way to iterate on a
tool:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tm_clearance","arguments":{"name":"Northwind"}}}' \
  | node src/index.js
```

The paid tools need credentials in the environment, never in the repo:

```bash
COMPANYINFO_USERNAME=… COMPANYINFO_PASSWORD=… node src/index.js
```

**The smoke test calls live third-party APIs.** A failure can mean upstream drift rather
than a regression — check the endpoint by hand before assuming the code broke. The four
paid `nl_company_*` tools are deliberately *not* in the suite: each run would cost money
and return real company data. Verify those by hand when you touch them.

## Architecture

`src/index.js` is layered top to bottom:

1. **Constants** — `OFFICES` (register codes), `LIVE` (which statuses count as a live
   right), `VIES_MS` (VAT member states).
2. **`http()`** — every outbound call goes through it. Three retries with backoff, 90s
   timeout, throws on non-2xx. It never converts a failure into an empty result.
3. **Source adapters**, one group per data source: TMview + EUIPO `copla` (trademarks),
   GLEIF + VIES (companies), `EU_REGISTERS` (eight national registers), and the
   Company.info SOAP layer (paid, Dutch Handelsregister).
4. **`TOOLS`** — JSON schemas — and **`HANDLERS`** — name → function.
5. **stdio loop** — line-buffered reader plus `dispatch()`, which tracks in-flight requests
   so a client closing stdin mid-call does not drop pending replies.

### Adding a tool

Three places, all in `src/index.js`: the handler function, a `TOOLS` entry, a `HANDLERS`
entry. Then bump the `tools.length` assertion in `test/smoke.js` (check 2) — it is there
precisely to catch a tool that was written but never wired up.

### The `EU_REGISTERS` contract

Each entry is `{ country_name, register, id, note?, byName?(query, n), byNumber?(id) }`.
The two methods resolve to `{ total, rows }`, where `rows` comes from that country's own
`xxRow()` mapper into the shared record shape. A country with no free register belongs in
`EU_NO_FREE_API` with a reason — that map is part of the contract, not documentation.

### SOAP without a dependency

The Company.info layer builds its own envelope and parses replies with `xmlToObj()`, a
~40-line XML-to-object parser, plus `arr()` to normalise the one-item-vs-many ambiguity.
That exists to keep the zero-dependency promise; prefer extending it over adding a client
library.

## Invariants

These are the decisions the code is built around. Breaking one is a regression even when
tests pass.

**Failures are loud.** This project exists because a commercial IP MCP server repackaged
EUIPO's `HTTP 403 not registered to plan` as `"No trademarks found"` — an empty result that
reads as a clean name while nothing was retrieved. Never map an error, a missing
credential, or an unsupported country to an empty list. Throw, and say why. Smoke checks
10, 14 and 15 assert this.

**Free core, optional paid.** Everything works with no key. The paid Company.info tools
stay *listed* when unconfigured and throw an error naming the env vars to set. Credentials
come from the environment only — this repository is public.

**Our surface is English and normalised; external field names are not touched.** Response
fields and parameters are English (`name`, `number`, `country`, `mark`, `live`, `verdict`,
`source`, `note`). But SOAP request keys, the TMview request body, GLEIF query params and
each register's own response shape keep their original spelling. When renaming, this is the
line that breaks quietly — the paid tools are the canary.

**Caps are enforced client-side.** SK and EE ignore their own limit parameters, so
`eu_company_search` slices after the fact and `per_country` reports `in_register` alongside
`returned`. Truncation must stay visible.

**`LIVE` decides what blocks.** Statuses outside that set are reported in their own bucket
(`identical_but_expired`) rather than dropped, because an expired mark is useful signal.

**Fixtures are neutral public records.** The test suite uses an EU word mark, a Danish
holding's LEI and a published VAT number. No project or customer data belongs in this repo
— its history was rebuilt once to remove exactly that.

Every response carries a `source` naming the register it came from, and a `note` with the
caveat that matters for that source. Keep both when adding tools.

See `README.md` for the per-tool parameter reference and the country coverage table.
