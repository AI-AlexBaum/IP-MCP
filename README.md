# ip-free-mcp

An MCP server for **EU and Benelux trademark research, and company lookup** over free,
public sources. No API keys. No subscription. No per-call billing.

Ask your assistant *"is the name Northwind free in classes 9 and 42?"* and get a verdict
backed by the actual registers — which marks are live, which expired, who holds them, and
what they cover. Then ask *"who is that holder?"* and get their legal form, national
register number, and group structure.

```
tm_clearance("Northwind", [9, 42])
  → NAME FREE, but live similar rights exist in your classes
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
| `tm_search` | Raw search across TMview. EU + Benelux by default, live rights only; flip `worldwide` for all national registers. |
| `tm_detail` | The full EUIPO case file for an EU application number: status, filing/registration/expiry dates, renewals, holder, oppositions, and the complete goods-and-services text per class. |
| `tm_offices` | The register codes you can pass to `tm_search` — 46 offices plus WIPO. |
| `company_search` | Find a company by name: legal form, status, address, national register number, LEI. Turns a mark holder into a known entity. |
| `company_detail` | The full GLEIF record for a LEI, plus group structure — direct parent, ultimate parent, subsidiaries. |
| `vat_check` | Verify an EU VAT number and get the officially registered name and address back. |
| `nl_company_search` ᵖ | Find a Dutch company in the Handelsregister by trade name, city, postcode or domain — including the SMEs GLEIF misses. |
| `nl_company_profile` ᵖ | Full Handelsregister profile: legal name, **all trade names**, legal form, RSIN, addresses. |
| `nl_company_vat` ᵖ | The VAT number for a KVK number — feed it to `vat_check` to confirm the name for free. |
| `nl_company_tree` ᵖ | Group structure for a KVK number: parents, subsidiaries and UBO. |

ᵖ = optional, **paid**, and off unless you configure credentials. Everything above the line
is free and needs no setup.
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
  "name": "Northwind",
  "classes_checked": [9, 42],
  "registers": ["EU (EUIPO)", "Benelux (NL/BE/LU)"],
  "verdict": "NAME FREE, but live similar rights exist in your classes",

  "identical_and_live": [],                     // blocks you outright
  "identical_but_expired": [                    // free again — but shows who tried
    { "mark": "NORTHWIND", "type": "Word", "status": "Ended",
      "application_date": "1998-03-11", "classes": [37, 42], "holder": ["Example Corp"] }
  ],
  "similar_live_in_your_classes": [             // the real risk surface
    { "mark": "Northwind Pro", "type": "Figurative", "status": "Registered",
      "number": "0XXXXXXXX", "classes": [9, 35, 42],
      "holder": ["Another Example GmbH"] }
  ],
  "live_in_benelux": [],                        // your home market specifically

  "counts": { "raw": 5, "live": 1, "identical_live": 0, "class_overlap": 1 }
}
```

Four verdicts are possible:

- `TAKEN` — an identical live mark exists in your classes. Pick another name.
- `IDENTICAL MARK EXISTS, but in other classes` — same name, different field. Often workable.
- `NAME FREE, but live similar rights exist in your classes` — nobody owns the name, but
  someone nearby is registered where you operate. Read `similar_live_in_your_classes`.
- `FREE` — no live identical mark and no class overlap.

Then feed a `number` from any result into `tm_detail` to see what that right actually
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

## Dutch companies (optional, paid)

GLEIF stops at entities that hold a LEI, which leaves out most Dutch B.V.s. The four
`nl_company_*` tools close that gap through **Company.info** (Webservices.nl), a commercial
Handelsregister reseller. They are billed per query, so they stay disabled until you supply
credentials — and they are listed either way, so the assistant can tell you what to set
rather than silently returning nothing.

Configure them in your MCP client, never in this repository:

```json
{
  "mcpServers": {
    "ip-free": {
      "command": "npx",
      "args": ["-y", "github:AI-AlexBaum/IP-MCP"],
      "env": {
        "COMPANYINFO_USERNAME": "your-user",
        "COMPANYINFO_PASSWORD": "your-password",
        "COMPANYINFO_WSDL_URL": "https://ws1.webservices.nl/soap_doclit"
      }
    }
  }
}
```

`COMPANYINFO_WSDL_URL` is optional and defaults to
`https://ws1.webservices.nl/soap_doclit.php`; a trailing `?wsdl` is stripped for you.

Called without credentials, every one of these tools returns an explicit *not configured*
error naming the variables to set. It never degrades into an empty result.

**The chain that makes this worth it:**

```
tm_clearance("SomeName")        → holder: Some Holding B.V.        (free)
nl_company_search("Some Holding") → KVK 12345678                    (paid, €)
nl_company_profile("12345678")  → all trade names, legal form, RSIN (paid, €)
nl_company_vat("12345678")      → NL123456789B01                    (paid, €)
vat_check("NL123456789B01")     → confirms name and address          (free)
nl_company_tree("12345678")     → who owns whom                      (paid, €)
```

`nl_company_profile` returns `all_trade_names`, and for trademark work that is the field
that matters most: in the Netherlands a trade name right arises from **use**, with no
registration to search. It is the one right a register sweep cannot find, and this is the
closest you get to it.

> **Privacy.** `nl_company_tree` returns names of natural persons — UBOs and directors.
> That is personal data under the GDPR. Do not pass it on more widely than the task needs,
> and do not paste it into anything public.
## National company registers

GLEIF covers only entities that hold a LEI. Most companies do not. So `eu_company_search`
goes straight to the national registers — the same data, at the source, free and without a
key. Leave `country` out and it queries all seven concurrently:

```
eu_company_search("Nordic", max_results: 2)
  → CZ  Nordic Invest s.r.o.        01582119   Primátorská 296/38, 18000 Praha 8
    SK  NORDIC-RACE s. r. o.        45954577   Svätoondrejská 11/5, 94501 Komárno
    FI  …   FR  …   NO  …   DK  …   EE  …

  per_country: { CZ: {in_register: 65, returned: 2}, SK: {in_register: 69, returned: 2}, … }
```

That `per_country` field is deliberate. Two of these registers ignore their own limit
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
| `name` | string | *required* | The name to clear |
| `nice_classes` | int[] | `[9, 42]` | Your classes — 9 is software, 42 is SaaS |

### `tm_search`
| Param | Type | Default | Notes |
|---|---|---|---|
| `query` | string | *required* | Substring search on the verbal element |
| `offices` | string[] | `["EM","BX"]` | Register codes, e.g. `["EM","BX","DE"]` |
| `worldwide` | boolean | `false` | Search every TMview register instead |
| `live_only` | boolean | `true` | Drop expired, refused, withdrawn, cancelled |
| `nice_classes` | int[] | — | Keep only marks touching these classes |
| `max_results` | int | `50` | Results are truncated, `truncated` says by how many |

Exact name matches are flagged with `exact_name` and sorted to the top.

### `tm_detail`
| Param | Type | Default | Notes |
|---|---|---|---|
| `number` | string | *required* | EU application number, e.g. `000039800`. Non-digits are stripped and the number is zero-padded to 9. EU marks only. |

### `tm_offices`
No parameters. Returns every register code with its name.

### `company_search`
| Param | Type | Default | Notes |
|---|---|---|---|
| `name` | string | *required* | Company name or part of it |
| `country` | string | — | ISO country code to narrow by, e.g. `DE`, `NL` |
| `max_results` | int | `10` | Capped at 50 |

### `company_detail`
| Param | Type | Default | Notes |
|---|---|---|---|
| `lei` | string | *required* | 20-character LEI, e.g. `5493005XXPWUMR2E5305` |

Returns the entity plus `direct_parent`, `ultimate_parent` and `children`. Only
relationships where **both** entities hold a LEI are visible.

### `vat_check`
| Param | Type | Default | Notes |
|---|---|---|---|
| `vat_number` | string | *required* | With country code, e.g. `NL123456789B01` |
| `country` | string | — | Country code, if it is not part of `vat_number` |

### `nl_company_search` (paid)
| Param | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | Trade name or part of it |
| `city` | string | — | City |
| `postal_code` | string | — | Postcode |
| `domain` | string | — | Domain name, e.g. `example.nl` |
| `kvk_number` | string | — | KVK number, if you already have it |
| `strict` | boolean | `false` | Exact rather than partial match |
| `page` | int | `1` | 20 results per page; the service caps totals at 500 |

At least one of `name`, `kvk_number` or `domain` is required.

### `nl_company_profile` (paid)
| Param | Type | Default | Notes |
|---|---|---|---|
| `kvk_number` | string | *required* | 8-digit KVK number |
| `establishment_number` | string | — | For one specific establishment |

### `nl_company_vat` / `nl_company_tree` (paid)
| Param | Type | Default | Notes |
|---|---|---|---|
| `kvk_number` | string | *required* | 8-digit KVK number |

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

One optional paid source, used only if you configure it:

- **Company.info / Webservices.nl** (`ws1.webservices.nl`) — the Dutch Handelsregister over
  SOAP. Reached with a hand-built envelope and a small XML parser, so the server keeps its
  zero-dependency promise.

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

Every response names the source it came from in a `source` field.

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
- **Responses use one flat, normalised shape** across every source. Every record names
  the register it came from in a `source` field.
- **The endpoints are public but undocumented.** They power the TMview and eSearch web
  UIs. They are free and need no key, and they can change without notice. Be considerate
  with request volume.
- **Patents are out of scope.** Trademarks only.
- **The paid tools cost money per call.** Each `nl_company_*` invocation is a billed query.
  They are deliberately separate tools rather than one fat call, so every charge is a
  decision you made.
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
