/**
 * Catalog of every Accord Fintech feed described in the technical documents
 * (StockPrices_DataFeedAPI_Display_Techdoc.pdf and
 *  CompanyFundamentals_DataFeedAPI_Display_Techdoc.pdf).
 *
 * Every feed is fetched from the same endpoint:
 *   https://contentapi.accordwebservices.com/RawData/GetRawDataJSON
 *     ?filename=<filename>&date=<ddmmyyyy>&section=<section>&sub=&token=<token>
 *
 * Only `filename` and `section` change per feed. Intraday feeds use a
 * sequential filename (yyyymmdd + nn, starting at 01) instead of a fixed name.
 *
 * This file is safe to import from both client and server code (no secrets).
 */

export type DatasetGroup =
  | "Stock Prices"
  | "Masters"
  | "Registrar & Board"
  | "Annual Financials"
  | "Quarterly Results"
  | "Equity & Shareholding";

export interface Dataset {
  /** Stable id used by the app's /api/accord route */
  id: string;
  label: string;
  group: DatasetGroup;
  /** Fixed filename, or null for intraday feeds (filename = yyyymmdd + nn) */
  filename: string | null;
  section: string;
  /** Primary-key columns, used to upsert/delete rows using the Flag column */
  primaryKey: string[];
  description: string;
  /** How often Accord publishes it (from the *_Frequency.xlsx sheets) */
  frequency: string;
}

export const DATASETS: Dataset[] = [
  // ───────────── Stock prices ─────────────
  {
    id: "nse-stocks-live",
    label: "NSE Stocks – Intraday (15-min delayed)",
    group: "Stock Prices",
    filename: null,
    section: "NseStocksLive",
    primaryKey: ["SYMBOL", "SERIES"],
    description:
      "Intraday NSE price snapshot. Link to Company Master using SYMBOL + SERIES.",
    frequency: "Intraday, sequential files yyyymmdd01, 02, 03…",
  },
  {
    id: "nse-indices-live",
    label: "NSE Indices – Intraday",
    group: "Stock Prices",
    filename: null,
    section: "NSEIndicesLive",
    primaryKey: ["Symbol"],
    description: "Intraday NSE index levels. Symbol links to Indicesmaster.INDEX_NAME.",
    frequency: "Intraday, sequential files yyyymmdd01, 02, 03…",
  },
  {
    id: "nse-adj-price",
    label: "NSE Adjusted Price (EOD)",
    group: "Stock Prices",
    filename: "Nseadjprice",
    section: "NSEStocksEOD",
    primaryKey: ["Fincode", "Date"],
    description: "End-of-day prices adjusted for bonus, split and rights.",
    frequency: "1× daily, 7:30 PM onwards (11:59 PM for historical adjustment)",
  },
  {
    id: "nse-indices-eod",
    label: "NSE Indices (EOD)",
    group: "Stock Prices",
    filename: "Indices_hst",
    section: "NSEIndicesEOD",
    primaryKey: ["SYMBOL", "DATE"],
    description: "End-of-day NSE index OHLC.",
    frequency: "1× daily, 7:00 PM onwards",
  },

  // ───────────── Masters ─────────────
  {
    id: "company-master",
    label: "Company Master",
    group: "Masters",
    filename: "Company_master",
    section: "Fundamental",
    primaryKey: ["FINCODE"],
    description:
      "Main company master. FINCODE maps to every other table; SYMBOL/SERIES map to NSE prices.",
    frequency: "4× daily between 10:00 AM and 10:30 PM",
  },
  {
    id: "indices-master",
    label: "Indices Master",
    group: "Masters",
    filename: "Indicesmaster",
    section: "Master",
    primaryKey: ["INDEX_CODE"],
    description: "BSE/NSE index codes and names.",
    frequency: "1× daily, 10:30 PM (only when changed)",
  },
  {
    id: "comp-indexpart",
    label: "Company Index Part",
    group: "Masters",
    filename: "Comp_Indexpart",
    section: "Master",
    primaryKey: ["FINCODE", "INDEX_CODE"],
    description: "Which companies belong to which index.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "industry-master",
    label: "Industry Master",
    group: "Masters",
    filename: "Industrymaster_Ex1",
    section: "Fundamental",
    primaryKey: ["Ind_code"],
    description: "Sector / industry codes.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "house-master",
    label: "House Master",
    group: "Masters",
    filename: "Housemaster",
    section: "Fundamental",
    primaryKey: ["HOUSE_CODE"],
    description: "Business house codes.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "stock-exchange-master",
    label: "Stock Exchange Master",
    group: "Masters",
    filename: "Stockexchangemaster",
    section: "Fundamental",
    primaryKey: ["STK_ID"],
    description: "Stock exchange codes.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "company-listings",
    label: "Company Listings",
    group: "Masters",
    filename: "Complistings",
    section: "Fundamental",
    primaryKey: ["FINCODE", "STK_ID"],
    description: "Exchanges on which each company is listed.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "company-address",
    label: "Company Address",
    group: "Masters",
    filename: "Companyaddress",
    section: "Fundamental",
    primaryKey: ["FINCODE"],
    description: "Registered office / contact details.",
    frequency: "1× daily, 10:30 PM",
  },

  // ───────────── Registrar & board ─────────────
  {
    id: "registrar-master",
    label: "Registrar Master",
    group: "Registrar & Board",
    filename: "Registrarmaster",
    section: "Fundamental",
    primaryKey: ["RegistrarNo"],
    description: "Registrar & transfer agents.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "registrar-data",
    label: "Registrar Data",
    group: "Registrar & Board",
    filename: "Registrardata",
    section: "Fundamental",
    primaryKey: ["FINCODE", "RegistrarNo"],
    description: "Company → registrar mapping.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "board",
    label: "Board of Directors",
    group: "Registrar & Board",
    filename: "Board",
    section: "Fundamental",
    primaryKey: ["FINCODE", "YRC", "SERIALNO", "DIRTYPE_ID"],
    description: "Board members per company.",
    frequency: "1× daily, 10:30 PM",
  },

  // ───────────── Annual financials ─────────────
  ...(
    [
      ["bs", "Balance Sheet", "Finance_bs", "Finance_cons_bs"],
      ["pl", "Profit & Loss", "Finance_pl", "Finance_cons_pl"],
      ["cf", "Cash Flow", "Finance_cf", "Finance_cons_cf"],
      ["fr", "Financial Ratios", "Finance_fr", "Finance_cons_fr"],
    ] as const
  ).flatMap(([key, name, std, cons]) => [
    {
      id: `finance-${key}`,
      label: `${name} (Standalone)`,
      group: "Annual Financials" as const,
      filename: std,
      section: "Fundamental",
      primaryKey: ["FINCODE", "Year_end", "TYPE"],
      description: `Annual ${name.toLowerCase()} – standalone. Row labels come from ${std}_Displayformat.`,
      frequency: "1× daily, 10:30 PM",
    },
    {
      id: `finance-cons-${key}`,
      label: `${name} (Consolidated)`,
      group: "Annual Financials" as const,
      filename: cons,
      section: "Fundamental",
      primaryKey: ["FINCODE", "Year_end", "TYPE"],
      description: `Annual ${name.toLowerCase()} – consolidated.`,
      frequency: "1× daily, 10:30 PM",
    },
  ]),

  // ───────────── Quarterly results ─────────────
  {
    id: "results-std",
    label: "Quarterly Results IND-AS (Standalone)",
    group: "Quarterly Results",
    filename: "Resultsf_IND_Ex1",
    section: "Fundamental",
    primaryKey: ["Fincode", "Result_Type", "Date_End"],
    description: "Quarterly results in IND-AS format – standalone.",
    frequency: "Every hour, 9:00 AM – 11:30 PM",
  },
  {
    id: "results-cons",
    label: "Quarterly Results IND-AS (Consolidated)",
    group: "Quarterly Results",
    filename: "Resultsf_IND_Cons_Ex1",
    section: "Fundamental",
    primaryKey: ["Fincode", "Result_Type", "Date_End"],
    description: "Quarterly results in IND-AS format – consolidated.",
    frequency: "Every hour, 9:00 AM – 11:30 PM",
  },

  // ───────────── Equity & shareholding ─────────────
  {
    id: "company-equity",
    label: "Company Equity (Standalone)",
    group: "Equity & Shareholding",
    filename: "company_equity",
    section: "CompanyEquity",
    primaryKey: ["FINCODE"],
    description: "Latest equity, market cap, EPS, P/E, book value etc.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "company-equity-cons",
    label: "Company Equity (Consolidated)",
    group: "Equity & Shareholding",
    filename: "company_equity_cons",
    section: "CompanyEquity",
    primaryKey: ["FINCODE"],
    description: "Consolidated equity figures.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "shp-summary",
    label: "Shareholding Pattern",
    group: "Equity & Shareholding",
    filename: "Shpsummary",
    section: "Fundamental",
    primaryKey: ["FINCODE", "DATE_END"],
    description: "Promoter / FII / DII / public holding by quarter.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "shp-details",
    label: "Shareholders Name",
    group: "Equity & Shareholding",
    filename: "Shp_details",
    section: "Fundamental",
    primaryKey: ["FINCODE", "DATE_END", "SRNO"],
    description: "Named shareholders holding more than 1%.",
    frequency: "1× daily, 10:30 PM",
  },
  {
    id: "shp-catmaster",
    label: "Shareholders Category Master",
    group: "Equity & Shareholding",
    filename: "Shp_catmaster_2",
    section: "Fundamental",
    primaryKey: ["SHP_CATID"],
    description: "Shareholder category codes.",
    frequency: "1× daily, 10:30 PM",
  },
];

export function getDataset(id: string): Dataset | undefined {
  return DATASETS.find((d) => d.id === id);
}

export function isIntraday(d: Dataset): boolean {
  return d.filename === null;
}

export const GROUPS: DatasetGroup[] = [
  "Stock Prices",
  "Masters",
  "Registrar & Board",
  "Annual Financials",
  "Quarterly Results",
  "Equity & Shareholding",
];
