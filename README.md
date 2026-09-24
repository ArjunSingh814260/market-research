# Accord Market Data – Next.js frontend

A Next.js (App Router, TypeScript, Tailwind) app for browsing the **Accord Fintech Data Feed API** – NSE 15‑min delayed prices, EOD prices, and company fundamentals – built from the technical documents in `NavdeepBajaj_DataFeedAPI_20260904`.

## Quick start

```bash
cd accord-market-app
npm install
cp .env.example .env.local   # already done for you – contains the sample token
npm run dev
```

Open http://localhost:3000.

- **Data Explorer** (`/`) – pick any of the 30 documented feeds, pick a date, click **Fetch**. Search, sort, and download the result as CSV/JSON.
- **NSE Live** (`/live`) – fetches intraday files `yyyymmdd01`, `02`, `03`… in order, merges them, and shows gainers, losers, most active and market breadth. **Catch up** reads every file for a past date; **Start polling** follows a live trading day.

The sample data Accord shared is for **31 July 2026** (`31072026`), which is the default date.

## ⚠️ IP whitelisting (read this first)

Accord only answers requests from **whitelisted public IPs** (max 2). From any other IP you get **HTTP 403**, which the app shows with a short explanation.

- If you see 403 on your laptop, set `ACCORD_MOCK=true` in `.env.local` and restart `npm run dev`. The app then serves made‑up data with the same field names, so you can work on the UI.
- For real data, run the app (or at least its server) on the machine whose IP Accord has whitelisted, and set `ACCORD_MOCK=false`.

## How fetching works

Every feed uses one endpoint. Only `filename` and `section` change:

```
https://contentapi.accordwebservices.com/RawData/GetRawDataJSON
  ?filename=<file>&date=<ddmmyyyy>&section=<section>&sub=&token=<token>
```

| Feed | filename | section |
|---|---|---|
| NSE intraday prices | `yyyymmdd` + `01`, `02`… (e.g. `2026073101`) | `NseStocksLive` |
| NSE intraday indices | `yyyymmdd` + `01`, `02`… | `NSEIndicesLive` |
| NSE adjusted EOD price | `Nseadjprice` | `NSEStocksEOD` |
| NSE indices EOD | `Indices_hst` | `NSEIndicesEOD` |
| Company master | `Company_master` | `Fundamental` |
| Balance sheet / P&L / Cash flow / Ratios | `Finance_bs`, `Finance_pl`, `Finance_cf`, `Finance_fr` (`Finance_cons_*` for consolidated) | `Fundamental` |
| Quarterly results | `Resultsf_IND_Ex1` / `Resultsf_IND_Cons_Ex1` | `Fundamental` |
| Company equity | `company_equity` / `company_equity_cons` | `CompanyEquity` |
| Shareholding | `Shpsummary`, `Shp_details`, `Shp_catmaster_2` | `Fundamental` |

The full list is in `src/lib/datasets.ts`.

**The browser never calls Accord directly.** It calls this app's own route, and the route calls Accord from the server:

```
Browser ──► /api/accord?dataset=nse-stocks-live&date=31072026&seq=2
              │   (src/app/api/accord/route.ts)
              ▼
         Accord API  (token added on the server from ACCORD_TOKEN)
```

Why: the token stays secret, the request comes from your server's (whitelisted) IP, and there are no CORS problems.

You can call the route yourself:

```bash
curl "http://localhost:3000/api/accord?dataset=company-master&date=31072026"
curl "http://localhost:3000/api/accord?dataset=nse-stocks-live&date=31072026&seq=1"
```

It returns `{ ok, status, count, rows, message, filename, url (token masked), … }`.

### Status codes (from `API_RequestResponse.pdf`)

| Code | Meaning |
|---|---|
| 200 | Data returned |
| 204 | No new/updated records for that file and date, or that intraday sequence isn't published yet |
| 403 | Your IP isn't whitelisted |
| 404 | Wrong URL (filename or section spelling) |

### Intraday sequence logic

As the tech doc describes: fetch `…01`; once it's applied, move to `…02` on the next interval; if a file isn't there yet (204), **retry the same number**. See `src/app/live/page.tsx`.

### A / O / D flags

Each row has a `Flag`:
- `A` or `O` – upsert (update if the primary key exists, otherwise insert)
- `D` – delete the row with that primary key

`applyFlags()` in `src/lib/rows.ts` does this in memory. It's the same logic you'll run as SQL `INSERT … ON CONFLICT UPDATE` / `DELETE` once you store the feeds in a database. Primary keys for every feed are in `src/lib/datasets.ts`.

## Project layout

```
src/
  app/
    api/accord/route.ts   ← server proxy to Accord
    page.tsx              ← Data Explorer
    live/page.tsx         ← NSE live prices
    layout.tsx
  components/
    DataTable.tsx         ← search / sort / paginate / CSV
    StatusBanner.tsx
  lib/
    datasets.ts           ← every feed: filename, section, PK, frequency
    accord.server.ts      ← builds URL, calls Accord, handles 204/403/404/timeouts
    rows.ts               ← normalises the JSON, applyFlags(), CSV
    dates.ts              ← ddmmyyyy + intraday filename helpers
    mock.ts               ← sample data for ACCORD_MOCK=true
```

## Environment variables

| Var | Purpose |
|---|---|
| `ACCORD_TOKEN` | Your Accord token (server-only) |
| `ACCORD_BASE_URL` | Endpoint (default shown above) |
| `ACCORD_MOCK` | `true` = serve sample data, `false` = call Accord |
| `ACCORD_TIMEOUT_MS` | Upstream timeout (default 60000) |
| `NEXT_PUBLIC_DEFAULT_DATE` | Date the UI opens on, `ddmmyyyy` |

## Notes

- The docs don't show the exact JSON wrapper Accord returns. `normalizeRows()` accepts a plain array, `{ "Table": [...] }`‑style objects, and double‑encoded JSON strings. If real responses look different, adjust that one function.
- Accord limits how often you can call each feed (see `*_Frequency.xlsx`, e.g. Company Master 4–6 hits/day). Don't poll master files in a loop.
- After you subscribe, Accord may change filenames and sections. Update `src/lib/datasets.ts`.
- For production, schedule a job (cron) that pulls each feed at its published time into a database, and have the frontend read from the database instead of calling Accord on every page view.
# market-research
