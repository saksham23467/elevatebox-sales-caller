import { toE164 } from "../config.ts";

export type ParsedLead = {
  phone: string;
  name?: string;
  city?: string;
  locality?: string;
  bhk?: string;
  budget?: string;
  source?: string;
  line: number;
};

export type CsvReject = {
  line: number;
  reason: "no_phone" | "bad_phone" | "duplicate";
  raw: string;
  phone?: string;
};

export type CsvParseResult = {
  rows: ParsedLead[];
  rejected: CsvReject[];
  unnamed: number;
  delimiter: string;
  headers: string[];
};

const PHONE_HEADERS = new Set([
  "phone",
  "phone number",
  "phonenumber",
  "mobile",
  "mobile no",
  "mobile no.",
  "mobileno",
  "mobile number",
  "contact",
  "contact no",
  "contact no.",
  "contact number",
  "number",
  "whatsapp",
  "whatsapp number",
  "cell",
  "cell no",
  "tel",
  "telephone",
  "msisdn",
]);

const NAME_HEADERS = new Set([
  "name",
  "full name",
  "fullname",
  "customer",
  "customer name",
  "lead",
  "lead name",
  "contact name",
  "client",
  "client name",
]);

const FIRST_HEADERS = new Set(["first name", "firstname", "first"]);
const LAST_HEADERS = new Set(["last name", "lastname", "last", "surname"]);
const CITY_HEADERS = new Set(["city", "town"]);
const LOCALITY_HEADERS = new Set(["locality", "area", "location", "micromarket"]);
const BHK_HEADERS = new Set(["bhk", "typology", "unit", "configuration"]);
const BUDGET_HEADERS = new Set(["budget", "budget band", "price"]);
const SOURCE_HEADERS = new Set(["source", "lead source", "channel"]);

const MAX_ROWS = 5000;

export function looksLikeSpreadsheetBinary(text: string): boolean {
  return text.startsWith("PK") || text.includes("xl/workbook");
}

export function indianMobileDigits(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;
  let core = digits;
  if (core.startsWith("91") && core.length >= 12) core = core.slice(-10);
  else if (core.startsWith("0") && core.length === 11) core = core.slice(1);
  else if (core.length > 10 && core.length <= 13) core = core.slice(-10);
  if (core.length !== 10) return null;
  if (!/^[6-9]\d{9}$/.test(core)) return null;
  return core;
}

export function normalizeIndiaPhone(input: string): string | null {
  const core = indianMobileDigits(input);
  if (!core) return null;
  const e164 = toE164(core);
  return e164.length === 13 ? e164 : null;
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/^\uFFFE/, "");
}

export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(sample: string): string {
  const candidates = [",", "\t", ";", "|"];
  const lines = sample.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map((l) => splitCsvLine(l, d).length);
    if (!counts.length) continue;
    const first = counts[0];
    const consistent = counts.every((n) => n === first && n > 1);
    const score = (consistent ? 100 : 0) + first;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function keyOf(header: string): string {
  return header.replace(/\s+/g, " ").trim().toLowerCase();
}

function headerMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const k = keyOf(h);
    if (PHONE_HEADERS.has(k) && map.phone == null) map.phone = i;
    else if (NAME_HEADERS.has(k) && map.name == null) map.name = i;
    else if (FIRST_HEADERS.has(k) && map.first == null) map.first = i;
    else if (LAST_HEADERS.has(k) && map.last == null) map.last = i;
    else if (CITY_HEADERS.has(k) && map.city == null) map.city = i;
    else if (LOCALITY_HEADERS.has(k) && map.locality == null) map.locality = i;
    else if (BHK_HEADERS.has(k) && map.bhk == null) map.bhk = i;
    else if (BUDGET_HEADERS.has(k) && map.budget == null) map.budget = i;
    else if (SOURCE_HEADERS.has(k) && map.source == null) map.source = i;
  });
  return map;
}

function inferPhoneColumn(rows: string[][]): number | null {
  if (!rows.length) return null;
  const width = Math.max(...rows.map((r) => r.length));
  let best = -1;
  let bestHits = 0;
  for (let col = 0; col < width; col++) {
    let hits = 0;
    for (const row of rows.slice(0, 40)) {
      if (indianMobileDigits(row[col] ?? "")) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = col;
    }
  }
  return bestHits >= 1 ? best : null;
}

function inferNameColumn(rows: string[][], phoneCol: number): number | null {
  const width = Math.max(...rows.map((r) => r.length));
  const order = [phoneCol - 1, phoneCol + 1, 0, 1].filter((i) => i >= 0 && i < width && i !== phoneCol);
  for (const col of order) {
    let names = 0;
    for (const row of rows.slice(0, 40)) {
      const cell = (row[col] ?? "").trim();
      if (cell && !indianMobileDigits(cell) && /[a-zA-Z\u0900-\u097F]/.test(cell)) names++;
    }
    if (names >= 1) return col;
  }
  return null;
}

function cell(row: string[], index: number | undefined): string {
  if (index == null) return "";
  return (row[index] ?? "").trim();
}

function joinName(row: string[], map: Record<string, number>): string {
  const full = cell(row, map.name);
  if (full) return full;
  const first = cell(row, map.first);
  const last = cell(row, map.last);
  return [first, last].filter(Boolean).join(" ").trim();
}

export function parseLeadCsv(text: string): CsvParseResult {
  if (looksLikeSpreadsheetBinary(text)) {
    throw new Error("This looks like an Excel file. Save it as CSV (comma-separated) and upload that.");
  }
  const raw = stripBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!lines.length) throw new Error("The file is empty.");

  const delimiter = detectDelimiter(lines.slice(0, 12).join("\n"));
  const parsedLines = lines.map((line) => splitCsvLine(line, delimiter));
  const first = parsedLines[0] ?? [];
  const firstLooksHeader = first.some((h) => {
    const k = keyOf(h);
    return PHONE_HEADERS.has(k) || NAME_HEADERS.has(k) || FIRST_HEADERS.has(k) || k === "email";
  });

  let headers = firstLooksHeader ? first : [];
  let body = firstLooksHeader ? parsedLines.slice(1) : parsedLines;
  let map = headerMap(headers);

  if (map.phone == null) {
    const sample = body.filter((r) => r.some((c) => c.trim()));
    const inferred = inferPhoneColumn(sample);
    if (inferred == null) throw new Error("No mobile numbers found. Need a column with 10-digit Indian mobiles.");
    map = { ...map, phone: inferred };
    if (map.name == null) {
      const nameCol = inferNameColumn(sample, inferred);
      if (nameCol != null) map.name = nameCol;
    }
    if (!headers.length) {
      headers = first.map((_, i) => (i === map.phone ? "phone" : i === map.name ? "name" : `col_${i + 1}`));
    }
  }

  const rows: ParsedLead[] = [];
  const rejected: CsvReject[] = [];
  const seen = new Set<string>();
  const headerOffset = firstLooksHeader ? 2 : 1;

  for (let i = 0; i < body.length; i++) {
    const row = body[i];
    const line = i + headerOffset;
    if (row.every((c) => !c.trim())) continue;
    const rawPhone = cell(row, map.phone);
    if (!rawPhone) {
      rejected.push({ line, reason: "no_phone", raw: row.join(delimiter).slice(0, 160) });
      continue;
    }
    const phone = normalizeIndiaPhone(rawPhone);
    if (!phone) {
      rejected.push({ line, reason: "bad_phone", raw: rawPhone.slice(0, 80), phone: rawPhone });
      continue;
    }
    if (seen.has(phone)) {
      rejected.push({ line, reason: "duplicate", raw: rawPhone, phone });
      continue;
    }
    if (rows.length >= MAX_ROWS) {
      rejected.push({ line, reason: "duplicate", raw: "truncated after 5000 numbers", phone });
      continue;
    }
    seen.add(phone);
    const name = joinName(row, map);
    rows.push({
      phone,
      name: name || undefined,
      city: cell(row, map.city) || undefined,
      locality: cell(row, map.locality) || undefined,
      bhk: cell(row, map.bhk) || undefined,
      budget: cell(row, map.budget) || undefined,
      source: cell(row, map.source) || undefined,
      line,
    });
  }

  if (!rows.length) throw new Error("No valid Indian mobile numbers in this file.");

  return {
    rows,
    rejected,
    unnamed: rows.filter((r) => !r.name).length,
    delimiter,
    headers: headers.map((h) => h || ""),
  };
}
