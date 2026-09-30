# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

A Next.js 16 (App Router, React 19, TypeScript, Tailwind v4) frontend over the **Accord Fintech Data Feed API**: NSE prices on a 15-minute delay, EOD prices, and company fundamentals. The source tech docs (PDF/XLSX) sit in the parent directory (`../StockPrices`, `../API_RequestResponse.pdf`, and so on) and in `CompanyFundamentals/`, which is git-ignored. Treat those docs as the source of truth for feed names, sections, fields and primary keys.

## Commands

```bash
npm run dev            # http://localhost:3000
npm run build
npm run lint           # eslint (flat config, eslint-config-next)
npx tsc --noEmit       # type-check
```

The repo has no test suite. To test the API layer, call the routes directly:

```bash
curl "http://localhost:3000/api/accord?dataset=company-master&date=31072026"
curl "http://localhost:3000/api/accord?dataset=nse-stocks-live&date=31072026&seq=1"
curl "http://localhost:3000/api/index-constituents?date=31072026&index=NIFTY%2050&source=auto"
```

## Environment (`.env.local`, template in `.env.example`)

- `ACCORD_TOKEN`: server-only token.
- `ACCORD_MOCK=true`: serves generated data from `src/lib/mock.ts` instead of calling Accord. Accord answers only whitelisted public IPs (max 2) and returns **403** to everyone else, so use mock mode for UI work on any other machine.
- `ACCORD_BASE_URL`, `ACCORD_TIMEOUT_MS` (default 60000), `NEXT_PUBLIC_DEFAULT_DATE` (`ddmmyyyy`), `NSE_INDEX_CSV_BASE` (niftyindices.com CSV base).
- The sample data Accord shared is for **31 July 2026** (`31072026`), which is also the default date.

## Architecture

**The browser never calls Accord directly.** Client pages call `getAccord()` (`src/lib/client.ts`), which calls `/api/accord` (`src/app/api/accord/route.ts`), which calls `fetchAccord()` (`src/lib/accord.server.ts`), which calls Accord. The proxy keeps the token secret, sends the request from the server's whitelisted IP, and avoids CORS. Files ending in `.server.ts` import `server-only`, so client components must not import them.

- **One endpoint for every feed.** Each Accord feed is `GetRawDataJSON?filename=&date=ddmmyyyy&section=&sub=&token=`. `src/lib/datasets.ts` is the single catalog: dataset `id` → filename, section, primary key and frequency. To add or rename a feed, change that file. Intraday feeds have `filename: null`, and the filename is built as `yyyymmdd` + a 2-digit sequence (`intradayFilename()` in `src/lib/dates.ts`). Note that the API `date` param is `ddmmyyyy` but intraday filenames are `yyyymmdd`.
- **`/api/accord` always returns HTTP 200** with a `FetchResult` body (`{ ok, status, source, count, rows, message, url (token masked), … }`). Accord's real status goes in `status`, and `explain()` maps it to a message the UI can show: 204 means no new data or the sequence isn't published yet, 403 means the IP isn't whitelisted, 404 means the filename or section is wrong. The UI reads `status`, not the HTTP code. Keep `AccordResponse` in `client.ts` in sync with `FetchResult`.
- **Response shape is uncertain.** `normalizeRows()` in `src/lib/rows.ts` accepts a plain array, `{Table:[…]}`, double-encoded JSON, or a single object. If real Accord payloads differ, fix it there only. Field names vary in case (`FINCODE`/`Fincode`), so read fields with `getField()`, never `row[key]`.
- **Incremental feeds and A/O/D flags.** Each row carries a `Flag`: `A` or `O` means upsert by primary key, `D` means delete. `applyFlags()` in `rows.ts` does this in memory. Master feeds are incremental: most days they carry only changes.
- **Intraday polling (`src/app/live/page.tsx`).** It fetches `…01`, `…02`, … in order and merges them by primary key. On a 204 it retries the same sequence number rather than skipping ahead.
- **Index constituents (`src/app/api/index-constituents/route.ts`).** Nifty 50 has no single feed. The route joins `Indicesmaster` (a name maps to `INDEX_CODE`) with `Comp_Indexpart` (an `INDEX_CODE` maps to SYMBOL/FINCODE). The base data comes from the one-time dumps in `data/Indicesmaster.json` and `data/Comp_Indexpart.json` if present, with the day's feed merged on top. The result is cached in memory per date for 6 hours, and only when both feeds returned rows. With `source=auto`, it falls back to NSE's official CSV (`src/lib/nseIndexList.server.ts`) when that list has more stocks. In mock mode it skips that CSV unless `source=nse` is set. `/indices` then filters `NseStocksLive` rows to those symbols, preferring `SERIES=EQ`.
- **Company fundamentals (`/company`, `/api/company`, `src/lib/fundamentals.server.ts`).** Statements are rendered server-side from the raw feeds plus `src/lib/displayFormats.json`, which is generated from `CompanyFundamentals/*_Displayformat.xlsx` by `scripts/build_display_formats.py` (needs `openpyxl`). Don't hand-edit that JSON. The format comes from `Company_master.FFORMAT`/`RFORMAT`, with `MAN` as the fallback. `FieldName` can be a formula; `evaluate()` handles it. All money is converted to ₹ Cr: annual rows use `UseUnit` together with the row's `Unit`, and results arrive in ₹ million. Files are loaded with `fetchAccordCached()` (memory, then `data/cache/<date>/<dataset>.json`, then Accord), so each is fetched from Accord at most once per date. Keep using it for any page that reads many files.
- **Index names.** Accord's `INDEX_NAME` holds short codes (`NIFTY` = Nifty 50, `BANKNIFTY` = Nifty Bank), and `INDEX_LNAME` holds the full name. `src/lib/indexNames.ts` (`findIndex`, `ALIASES`) resolves familiar names to those codes, and `nseIndexList.server.ts` has its own map from names to CSV files. Update both when adding an index.

## Constraints

- Accord limits how often each feed can be called (see the `*_Frequency.xlsx` files; Company Master allows about 4–6 hits a day). Don't add loops or auto-refresh on master or fundamental feeds.
- Accord may change filenames or sections after subscription. Those changes belong in `datasets.ts`.
