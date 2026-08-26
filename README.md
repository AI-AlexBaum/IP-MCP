# ip-free-mcp

An MCP server for **EU and Benelux trademark research, and company lookup** over free,
public sources. No API keys. No subscription. No per-call billing.

Ask your assistant *"is the name Northwind free in classes 9 and 42?"* and get a verdict
backed by the actual registers — which marks are live, which expired, who holds them, and
what they cover. Then ask *"who is that holder?"* and get their legal form, national
register number, and group structure.

```
tm_clearance("Northwind", [9, 42])
  → NAAM VRIJ, maar er zijn levende, gelijkende rechten in jouw klassen
    identical + live ......... 0
    identical but expired .... 2   the name was claimed once and let go
    live overlap in 9/42 ..... 1   a figurative mark, same classes, valid to 2031
```

*(Illustrative. Run it on your own name for real numbers.)*

## Why this exists

The hosted IP MCP servers all want credentials. The official EUIPO API needs a developer
account *and* a plan subscription on top of it, and until that subscription is approved
every query returns HTTP 403.

The trap: at least one commercial MCP server repackages that 403 as
`"No trademarks found"`. An empty result then looks like a clean name while nothing was
ever retrieved. That is a decision-grade error, and it bills you per call for the
privilege.

This server sidesteps the whole problem. It reads the same registers through endpoints
that are public and free, and it tells you which source answered.

## What it can do

| Tool | What it gives you |
|---|---|
| `tm_clearance` | **Start here.** A verdict on one name in EU + Benelux, split into identical-and-live, identical-but-expired, and live look-alikes in your Nice classes. |
| `tm_search` | Raw search across TMview. EU + Benelux by default, live rights only; flip `wereldwijd` for all national registers. |
| `tm_detail` | The full EUIPO case file for an EU application number: status, filing/registration/expiry dates, renewals, holder, oppositions, and the complete goods-and-services text per class. |
| `tm_offices` | The register codes you can pass to `tm_search` — 46 offices plus WIPO. |
| `company_search` | Find a company by name: legal form, status, address, national register number, LEI. Turns a mark holder into a known entity. |
| `company_detail` | The full GLEIF record for a LEI, plus group structure — direct parent, ultimate parent, subsidiaries. |
| `vat_check` | Verify an EU VAT number and get the officially registered name and address back. |
| `eu_company_search` | Search **seven national company registers** by name at once — CZ, SK, FI, FR, NO, DK, EE. |
| `eu_company_by_number` | Look a company up by its national number (CZ by IČO, PL by NIP/REGON). |
| `eu_company_sources` | Which countries have a free register, which don't, and why. |

## Install

Requires Node 18 or newer. Nothing else — the server has zero dependencies.

**Claude Code**

```bash
claude mcp add --scope user ip-free -- npx -y github:AI-AlexBaum/IP-MCP
```

**Claude Desktop / Cursor / any MCP client** — add to your config:

```json
{
  "mcpServers": {
    "ip-free": {
      "command": "npx",
      "args": ["-y", "github:AI-AlexBaum/IP-MCP"]
    }
  }
}
```

**From a clone**

```bash
git clone https://github.com/AI-AlexBaum/IP-MCP.git
cd IP-MCP && npm run smoke     # verifies all four tools against the live registers
node src/index.js              # speaks MCP over stdio
```

## Reading a clearance result

`tm_clearance` returns four buckets, and the difference between them is the whole point.

```jsonc
{
  "naam": "Northwind",
  "gecheckte_klassen": [9, 42],
  "registers": ["EU (EUIPO)", "Benelux (NL/BE/LU)"],
  "oordeel": "NAAM VRIJ, maar er zijn levende, gelijkende rechten in jouw klassen",

  "identiek_en_levend": [],                    // blocks you outright
  "identiek_maar_verlopen": [                  // free again — but shows who tried
    { "merk": "NORTHWIND", "type": "Word", "status": "Ended",
      "aanvraagdatum": "1998-03-11", "klassen": [37, 42], "houder": ["Example Corp"] }
  ],
  "gelijkend_levend_in_jouw_klassen": [        // the real risk surface
    { "merk": "Northwind Pro", "type": "Figurative", "status": "Registered",
      "nummer": "0XXXXXXXX", "klassen": [9, 35, 42],
      "houder": ["Another Example GmbH"] }
  ],
  "levend_in_benelux": [],                     // your home market specifically

  "aantallen": { "ruw": 5, "levend": 1, "identiek_levend": 0, "overlap_in_klassen": 1 }
}
```

Four verdicts are possible:

- `BEZET` — an identical live mark exists in your classes. Pick another name.
- `IDENTIEK MERK BESTAAT, maar in andere klassen` — same name, different field. Often workable.
- `NAAM VRIJ, maar er zijn levende, gelijkende rechten in jouw klassen` — nobody owns the
  name, but someone nearby is registered where you operate. Read `gelijkend_levend_in_jouw_klassen`.
- `VRIJ` — no live identical mark and no class overlap.

Then feed a `nummer` from any result into `tm_detail` to see what that right actually
covers, whether it was ever opposed, and how long it runs.

## Company lookup

A trademark search hands you a holder name. These three tools turn that into something you
can act on.

```
company_search("KIRKBI", land: "DK")
  → KIRKBI A/S · ACTIVE · register no. 18591235
    LEI 5493005XXPWUMR2E5305

company_detail("5493005XXPWUMR2E5305")
  → direct parent ..... none (top of its group, or the parent holds no LEI)
    subsidiaries ...... 2

vat_check("DK47458714")
  → valid · Lego System A/S · Åstvej 1, 7190 Billund
```

The two sources answer different questions, and neither is a company register:

- **GLEIF** is the global LEI database. It searches by name and exposes group structure,
  which no free company register does. Its limit is coverage: only entities that hold a
  LEI are in it. Large companies and anything active in financial markets almost always
  are; a lot of SMEs are not. **An empty result means no LEI, not no company.**
- **VIES** is the EU's VAT validation service. It confirms a number is live and returns the
  name and address the national tax authority holds — which makes it the stronger check
  when you already have the number. You cannot search it by name.

For a Dutch B.V. with no LEI there is no free, keyless source at all. That needs the KVK
handelsregister, which requires an account and, for production use, a paid plan.

## National company registers

GLEIF covers only entities that hold a LEI. Most companies do not. So `eu_company_search`
goes straight to the national registers — the same data, at the source, free and without a
key. Leave `land` out and it queries all seven concurrently:

```
eu_company_search("Nordic", max_results: 2)
  → CZ  Nordic Invest s.r.o.        01582119   Primátorská 296/38, 18000 Praha 8
    SK  NORDIC-RACE s. r. o.        45954577   Svätoondrejská 11/5, 94501 Komárno
    FI  …   FR  …   NO  …   DK  …   EE  …

  per_land: { CZ: {in_register: 65, geleverd: 2}, SK: {in_register: 69, geleverd: 2}, … }
```

That `per_land` field is deliberate. Two of these registers ignore their own limit
parameter, so the cap is enforced client-side — and the response tells you both what the
register matched and what you were handed, rather than quietly truncating.

### What is covered

| Country | Register | Identifier | By name | Notes |
|---|---|---|---|---|
| **CZ** | ARES (Ministry of Finance) | IČO | ✔ | Also by number; returns VAT number too |
| **SK** | RPO (Statistical Office) | IČO | ✔ | Name and address history, current entry picked |
| **FI** | PRH avoindata | Business ID | ✔ | Legal form in English, website |
| **FR** | recherche-entreprises (INSEE/RNE) | SIREN | ✔ | Includes VAT number |
| **NO** | Brønnøysund Enhetsregisteret | Org.nr | ✔ | Flags bankruptcy and liquidation |
| **DK** | CVR via cvrapi.dk | CVR | ✔ | Returns only the single best match |
| **EE** | Ariregister (RIK) | Registrikood | ✔ | Name and number only, no address |
| **PL** | VAT register (Ministry of Finance) | NIP / REGON | — | By number only; name search is not offered |

### What is not, and why

Every European country was probed. These have no free keyless register, and
`eu_company_sources` returns this list with the reason so an empty result is never read as
"no such company":

AT, BE, BG, CH, CY, DE, ES, GR, HR, HU, IE, IS, IT, LT, LU, LV, MT, NL, PT, RO, SE, SI, UK.

Three of those are worth knowing about specifically. **UK** Companies House is free but
needs a (free) API key. **CH** Zefix was open and now answers `401`. **NL** needs a paid
subscription — see the `nl_company_*` tools if you have one.

## Tool reference

### `tm_clearance`
| Param | Type | Default | Notes |
|---|---|---|---|
| `naam` | string | *required* | The name to clear |
| `nice_classes` | int[] | `[9, 42]` | Your classes — 9 is software, 42 is SaaS |

### `tm_search`
| Param | Type | Default | Notes |
|---|---|---|---|
| `query` | string | *required* | Substring search on the verbal element |
| `offices` | string[] | `["EM","BX"]` | Register codes, e.g. `["EM","BX","DE"]` |
| `wereldwijd` | boolean | `false` | Search every TMview register instead |
| `alleen_levend` | boolean | `true` | Drop expired, refused, withdrawn, cancelled |
| `nice_classes` | int[] | — | Keep only marks touching these classes |
| `max_results` | int | `50` | Results are truncated, `afgekapt` says by how many |

Exact name matches are flagged with `exacte_naam` and sorted to the top.

### `tm_detail`
| Param | Type | Default | Notes |
|---|---|---|---|
| `nummer` | string | *required* | EU application number, e.g. `000039800`. Non-digits are stripped and the number is zero-padded to 9. EU marks only. |

### `tm_offices`
No parameters. Returns every register code with its name.

### `company_search`
| Param | Type | Default | Notes |
|---|---|---|---|
| `naam` | string | *required* | Company name or part of it |
| `land` | string | — | ISO country code to narrow by, e.g. `DE`, `NL` |
| `max_results` | int | `10` | Capped at 50 |

### `company_detail`
| Param | Type | Default | Notes |
|---|---|---|---|
| `lei` | string | *required* | 20-character LEI, e.g. `5493005XXPWUMR2E5305` |

Returns the entity plus `directe_moeder`, `uiteindelijke_moeder` and `dochters`. Only
relationships where **both** entities hold a LEI are visible.

### `vat_check`
| Param | Type | Default | Notes |
|---|---|---|---|
| `btw_nummer` | string | *required* | With country code, e.g. `NL123456789B01` |
| `land` | string | — | Country code, if it is not part of `btw_nummer` |

Country codes are validated before the call, so a typo fails locally instead of returning a
meaningless *invalid*. Greece is accepted as either `GR` or `EL`.

## How it works

Four public endpoints, no authentication on any of them:

- **TMview** (`tmdn.org`) — the shared search service of EUIPO and the national offices.
  Covers EU, Benelux, all EU member states, EFTA, WIPO international registrations and a
  long tail beyond Europe. Paged 100 records at a time, up to 10 pages per query.
- **EUIPO eSearch** (`euipo.europa.eu/copla`) — the same case-file data the public eSearch
  UI renders, including goods-and-services text and the opposition history.
- **GLEIF** (`api.gleif.org`) — the official LEI register. Company identity, national
  registration numbers, and the parent/child relationships that make up a group.
- **EU VIES** (`ec.europa.eu/taxation_customs/vies`) — VAT number validation, returning the
  name and address on file with the national tax authority.
- **Eight national company registers** — CZ, SK, FI, FR, NO, DK, EE and PL, each queried at
  its own source and normalised into one shape. Field names are aligned; source coverage is
  not, so each row names the register it came from.

Three decisions shape every answer:

1. **Live vs dead.** A right only counts if its status is one of *Registered, Filed,
   Application published, Application accepted, Opposition period, Expiring, Registration
   pending*. Everything else — *Ended, Expired, Withdrawn, Refused, Cancelled* — blocks
   nothing, so it is reported separately rather than silently dropped.
2. **Exact vs similar.** Names are compared with case, spaces and punctuation removed, so
   `NorthWind`, `NORTHWIND` and `north-wind` are one name. Everything else that came back
   is a look-alike, and only matters where the classes overlap.
3. **Failures stay loud.** Each request retries three times with backoff; if a source is
   unreachable the tool returns an explicit error. It never converts a failed lookup into
   an empty result set.

Every response names the source it came from in a `bron` field.

## Nice classes worth knowing

| Class | Covers |
|---|---|
| 9 | Software, downloadable programs, apps |
| 35 | Advertising, business administration, data processing |
| 36 | Insurance, financial services |
| 37 | Vehicle maintenance and repair |
| 38 | Telecommunications, network access |
| 39 | Transport, fleet logistics |
| 42 | SaaS, software development, IT services |

For most software products, clearing 9 and 42 is the minimum — hence the default.

## Limits and caveats

- **This is register data, not legal advice.** It tells you what is on file. Whether a mark
  is infringed, or a name registrable, is a call for a trademark attorney.
- **Registers lag.** TMview statuses trail the source registers. Confirm any live right
  that matters with `tm_detail`, which reads EUIPO directly.
- **Unregistered rights are invisible here.** In the Netherlands a trade name right arises
  from use alone (*handelsnaamrecht*), with no registration to find. An empty result is not
  proof a name is unused.
- **`tm_detail` is EU-only.** National case files are not exposed through this endpoint.
- **Company coverage is uneven.** GLEIF only holds entities with a LEI, so many SMEs are
  missing entirely, and a `LAPSED` LEI status means the identifier was not renewed — the
  company itself may well still trade. VIES needs the VAT number up front. Neither
  replaces a national company register.
- **Field names in responses are Dutch** (`merk`, `levend`, `oordeel`, `houder`). The tool
  was built for Benelux and EU practice. Tool descriptions are Dutch too.
- **The endpoints are public but undocumented.** They power the TMview and eSearch web
  UIs. They are free and need no key, and they can change without notice. Be considerate
  with request volume.
- **Patents are out of scope.** Trademarks only.
- **National registers differ in freshness and depth.** The fields are normalised, the
  coverage is not. Estonia returns no address, Denmark returns one match rather than a list,
  and each register updates on its own schedule. A hit in one country says nothing about
  another.

## Development

```bash
npm run smoke     # drives all four tools over stdio against the live registers
node --check src/index.js
```

The whole server is one dependency-free file, `src/index.js`: an HTTP helper with retries,
one function per tool, the JSON-RPC tool schemas, and a line-buffered stdio loop. Requests
are handled concurrently and the process stays alive until every in-flight call has
answered.

## License

MIT — see [LICENSE](LICENSE).
