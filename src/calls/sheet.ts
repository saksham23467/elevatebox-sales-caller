import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CallRecord } from "../store.ts";

export const CALLS_CSV = join(dirname(fileURLToPath(import.meta.url)), "../../data/calls.csv");

const HEADERS = [
  "id",
  "at",
  "updated",
  "direction",
  "phone",
  "status",
  "classification",
  "hot_or_cold",
  "language",
  "locality",
  "bhk",
  "budget",
  "timeline",
  "end_use",
  "products",
  "barrier",
  "visit_at",
  "callback_at",
  "voicemail",
  "summary",
  "quotes",
  "reasons",
] as const;

export type CallSheetRow = Record<(typeof HEADERS)[number], string>;

function emptyRow(): CallSheetRow {
  return Object.fromEntries(HEADERS.map((h) => [h, ""])) as CallSheetRow;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function hotOrCold(classification?: string): string {
  if (classification === "hot") return "HOT";
  if (classification === "cold" || classification === "warm") return "COLD";
  return "";
}

export function rowFromCall(c: CallRecord): CallSheetRow {
  const q = c.qualification;
  return {
    id: c.id,
    at: c.createdAt ?? "",
    updated: c.updatedAt ?? "",
    direction: c.direction ?? "outbound",
    phone: c.to ?? "",
    status: c.status ?? "",
    classification: c.classification ?? "",
    hot_or_cold: hotOrCold(c.classification),
    language: c.language ?? q?.language ?? "",
    locality: q?.locality ?? "",
    bhk: q?.bhk ?? "",
    budget: q?.budget ?? "",
    timeline: q?.timeline ?? "",
    end_use: q?.endUse ?? "",
    products: q?.products ?? "",
    barrier: q?.barrier ?? "",
    visit_at: c.visitAt ?? q?.visitAt ?? "",
    callback_at: c.callbackAt ?? "",
    voicemail: c.voicemail ? "yes" : "",
    summary: (c.summary ?? "").replace(/\s+/g, " ").slice(0, 500),
    quotes: (q?.quotes ?? []).join(" | ").slice(0, 500),
    reasons: (q?.reasons ?? []).join("; ").slice(0, 500),
  };
}

function loadMap(): Map<string, CallSheetRow> {
  const map = new Map<string, CallSheetRow>();
  if (!existsSync(CALLS_CSV)) return map;
  const raw = readFileSync(CALLS_CSV, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return map;
  const header = parseLine(lines[0]);
  for (const line of lines.slice(1)) {
    const cells = parseLine(line);
    const row = emptyRow();
    header.forEach((h, i) => {
      if (h in row) row[h as keyof CallSheetRow] = cells[i] ?? "";
    });
    if (row.id) map.set(row.id, row);
  }
  return map;
}

function writeMap(map: Map<string, CallSheetRow>) {
  mkdirSync(dirname(CALLS_CSV), { recursive: true });
  const rows = [...map.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const body = [
    HEADERS.join(","),
    ...rows.map((r) => HEADERS.map((h) => csvEscape(r[h] ?? "")).join(",")),
  ].join("\n");
  writeFileSync(CALLS_CSV, `\uFEFF${body}\n`);
}

export function upsertCallRow(call: CallRecord) {
  const map = loadMap();
  map.set(call.id, rowFromCall(call));
  writeMap(map);
}

export function syncCallsFromStore(calls: CallRecord[]) {
  const map = loadMap();
  for (const c of calls) map.set(c.id, rowFromCall(c));
  writeMap(map);
}

export function listCallRows(limit = 50): CallSheetRow[] {
  return [...loadMap().values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

export function csvFileBytes(): Buffer {
  if (!existsSync(CALLS_CSV)) {
    return Buffer.from(`\uFEFF${HEADERS.join(",")}\n`);
  }
  return readFileSync(CALLS_CSV);
}
