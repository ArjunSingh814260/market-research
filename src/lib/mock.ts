/**
 * Mock data used when ACCORD_MOCK=true (e.g. before your server IP is
 * whitelisted by Accord). Field names match the technical documents so the
 * UI behaves the same with real data. Values are made up.
 */
import type { Dataset } from "./datasets";
import type { Row } from "./rows";

const COMPANIES: [number, string, string, string, number][] = [
  // fincode, symbol, company name, industry, base price
  [100325, "RELIANCE", "Reliance Industries Ltd", "Refineries", 1410],
  [132540, "TCS", "Tata Consultancy Services Ltd", "IT - Software", 3080],
  [100180, "HDFCBANK", "HDFC Bank Ltd", "Bank - Private", 1985],
  [100209, "INFY", "Infosys Ltd", "IT - Software", 1520],
  [132174, "ICICIBANK", "ICICI Bank Ltd", "Bank - Private", 1440],
  [100112, "SBIN", "State Bank of India", "Bank - Public", 805],
  [100397, "BHARTIARTL", "Bharti Airtel Ltd", "Telecomm-Service", 1890],
  [100696, "HINDUNILVR", "Hindustan Unilever Ltd", "FMCG", 2460],
  [100875, "ITC", "ITC Ltd", "Cigarettes", 415],
  [100500, "LT", "Larsen & Toubro Ltd", "Infrastructure", 3620],
  [100532, "ULTRACEMCO", "UltraTech Cement Ltd", "Cement", 12150],
  [100570, "TATAMOTORS", "Tata Motors Ltd", "Automobile", 690],
  [100520, "M&M", "Mahindra & Mahindra Ltd", "Automobile", 3150],
  [100114, "TITAN", "Titan Company Ltd", "Diamond & Jewellery", 3380],
  [100535, "WIPRO", "Wipro Ltd", "IT - Software", 252],
  [132215, "AXISBANK", "Axis Bank Ltd", "Bank - Private", 1075],
  [100247, "KOTAKBANK", "Kotak Mahindra Bank Ltd", "Bank - Private", 1990],
  [132977, "SUNPHARMA", "Sun Pharmaceutical Industries Ltd", "Pharmaceuticals", 1640],
  [100034, "BAJFINANCE", "Bajaj Finance Ltd", "Finance - NBFC", 880],
  [100470, "TATASTEEL", "Tata Steel Ltd", "Steel", 158],
  [100530, "NESTLEIND", "Nestle India Ltd", "FMCG", 1175],
  [132555, "NTPC", "NTPC Ltd", "Power Generation", 340],
  [100312, "ONGC", "Oil & Natural Gas Corpn Ltd", "Crude Oil", 238],
  [100820, "ASIANPAINT", "Asian Paints Ltd", "Paints", 2410],
  [132313, "MARUTI", "Maruti Suzuki India Ltd", "Automobile", 12600],
];

/** Small deterministic PRNG so the same seq always returns the same prices. */
function rand(seed: number) {
  let t = seed + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function ddmmyyyyToDate(date: string) {
  return `${date.slice(4, 8)}-${date.slice(2, 4)}-${date.slice(0, 2)}`;
}

function nseLive(date: string, seq: number): Row[] {
  const day = ddmmyyyyToDate(date);
  // Each file ≈ one 15-minute snapshot starting 09:30
  const mins = 9 * 60 + 30 + (seq - 1) * 15;
  const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:00`;
  return COMPANIES.map(([, symbol, , , base], i) => {
    const prev = base;
    let ltp = prev;
    for (let s = 1; s <= seq; s++) ltp *= 1 + (rand(i * 1000 + s) - 0.5) * 0.008;
    ltp = r2(ltp);
    const open = r2(prev * (1 + (rand(i * 7) - 0.5) * 0.006));
    const high = r2(Math.max(open, ltp) * (1 + rand(i * 11 + seq) * 0.004));
    const low = r2(Math.min(open, ltp) * (1 - rand(i * 13 + seq) * 0.004));
    const volume = Math.round(50000 + rand(i * 17 + seq) * 5_000_000) * seq;
    return {
      SECURITYTOKEN: 1000 + i,
      SYMBOL: symbol,
      SERIES: "EQ",
      LTP: ltp,
      BBUY_QTY: Math.round(rand(i + seq * 3) * 900) + 1,
      BBUY_PRICE: r2(ltp - 0.05),
      BSELL_QTY: Math.round(rand(i + seq * 5) * 900) + 1,
      BSELL_PRICE: r2(ltp + 0.05),
      VOLUME: volume,
      AVGPRICE: r2((open + ltp) / 2),
      Open: open,
      High: high,
      Low: low,
      CLOSEPRICE: 0,
      VALUE: r2((volume * ltp) / 1e7),
      PREV_PRICE: prev,
      CHANGE: r2(ltp - prev),
      PER_CHANGE: r2(((ltp - prev) / prev) * 100),
      UPD_TIME: `${day}T${time}`,
    };
  });
}

function companyMaster(): Row[] {
  return COMPANIES.map(([fincode, symbol, name, industry], i) => ({
    FINCODE: fincode,
    SCRIPCODE: 500000 + i * 7,
    SCRIP_NAME: symbol,
    SCRIP_GROUP: "A",
    COMPNAME: name,
    IND_CODE: 10 + i,
    industry,
    HSE_CODE: 1,
    house: "Sample House",
    SYMBOL: symbol,
    SERIES: "EQ",
    ISIN: `INE${String(fincode).padStart(6, "0")}01${i % 10}`,
    S_NAME: name.replace(/ Ltd$/, ""),
    FV: [1, 2, 5, 10][i % 4],
    Status: "Active",
    securitytoken: 1000 + i,
    FLAG: "A",
  }));
}

function nseIndicesLive(date: string, seq: number): Row[] {
  const day = ddmmyyyyToDate(date);
  return (
    [
      ["NIFTY", 24850],
      ["BANKNIFTY", 55900],
      ["NIFTYIT", 36200],
      ["NIFTYJUNIOR", 67100],
      ["NIFTYMIDCAP", 57300],
    ] as const
  ).map(([symbol, prev], i) => {
    let close: number = prev;
    for (let s = 1; s <= seq; s++) close *= 1 + (rand(i * 97 + s) - 0.5) * 0.004;
    close = r2(close);
    return {
      Indextoken: 26000 + i,
      Symbol: symbol,
      Close: close,
      Open: r2(prev * 1.001),
      High: r2(close * 1.002),
      Low: r2(close * 0.998),
      Volume: 0,
      Value: 0,
      prev_close: prev,
      Change: r2(close - prev),
      Per_Change: r2(((close - prev) / prev) * 100),
      Updtime: `${day}T15:30:00`,
      Flag: "A",
    };
  });
}

function nseAdjPrice(date: string): Row[] {
  const day = ddmmyyyyToDate(date);
  return COMPANIES.map(([fincode, symbol, , , base], i) => {
    const close = r2(base * (1 + (rand(i * 31) - 0.5) * 0.02));
    const volume = Math.round(rand(i * 37) * 8_000_000);
    return {
      Fincode: fincode,
      Symbol: symbol,
      Date: `${day}T00:00:00`,
      Open: base,
      High: r2(Math.max(base, close) * 1.004),
      Low: r2(Math.min(base, close) * 0.996),
      Close: close,
      Volume: volume,
      Value: r2((volume * close) / 1e7),
      Flag: "A",
    };
  });
}

/** Index membership: every mock company is in NIFTY 50 (20); banks also in NIFTY BANK (21), IT in NIFTY IT (22). */
function compIndexpart(): Row[] {
  const rows: Row[] = [];
  COMPANIES.forEach(([fincode, symbol, , industry], i) => {
    const codes = [20];
    if (industry.startsWith("Bank")) codes.push(21);
    if (industry === "IT - Software") codes.push(22);
    for (const code of codes)
      rows.push({ FINCODE: fincode, SCRIPCODE: 500000 + i * 7, SYMBOL: symbol, INDEX_CODE: code, Flag: "A" });
  });
  return rows;
}

function indicesMaster(): Row[] {
  // Accord uses short NSE codes in INDEX_NAME and the full name in INDEX_LNAME.
  return (
    [
      ["NIFTY", "Nifty 50"],
      ["BANKNIFTY", "Nifty Bank"],
      ["NIFTYIT", "Nifty IT"],
      ["NIFTYJUNIOR", "Nifty Next 50"],
      ["NIFTYMIDCAP", "Nifty Midcap 100"],
    ] as const
  ).map(
    ([name, lname], i) => ({
      INDEX_CODE: 20 + i,
      EXCHANGE: "NSE",
      INDEX_NAME: name,
      INDEX_LNAME: lname,
      flag: "A",
    }),
  );
}

/** Generic fallback: one row per company with the dataset's primary keys. */
function generic(dataset: Dataset): Row[] {
  return COMPANIES.slice(0, 10).map(([fincode, symbol, name], i) => {
    const row: Row = {};
    for (const k of dataset.primaryKey) {
      const lk = k.toLowerCase();
      row[k] = lk === "fincode" ? fincode : lk.includes("date") || lk === "year_end" ? 202603 : i + 1;
    }
    row.COMPNAME = name;
    row.SYMBOL = symbol;
    row.SAMPLE_VALUE = r2(rand(i * 53) * 10000);
    row.FLAG = i === 9 ? "D" : i % 3 === 0 ? "O" : "A";
    return row;
  });
}

export function mockRows(dataset: Dataset, date: string, seq: number): Row[] {
  switch (dataset.id) {
    case "nse-stocks-live":
      // Pretend the market has produced 25 files that day.
      return seq > 25 ? [] : nseLive(date, seq);
    case "nse-indices-live":
      return seq > 25 ? [] : nseIndicesLive(date, seq);
    case "company-master":
      return companyMaster();
    case "nse-adj-price":
      return nseAdjPrice(date);
    case "indices-master":
      return [
        ...indicesMaster(),
        { INDEX_CODE: 1, EXCHANGE: "BSE", INDEX_NAME: "SENSEX", INDEX_LNAME: "S&P BSE SENSEX", flag: "A" },
      ];
    case "comp-indexpart":
      return compIndexpart();
    default:
      return generic(dataset);
  }
}
