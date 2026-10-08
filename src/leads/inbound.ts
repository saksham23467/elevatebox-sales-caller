import { normalizeIndiaPhone } from "./csv.ts";

export type InboundLead = {
  phone: string;
  name?: string;
  source: string;
  city?: string;
  locality?: string;
  bhk?: string;
  budget?: string;
};

const PHONE_KEYS = [
  "phone",
  "mobile",
  "mobileno",
  "mobile_no",
  "mobile_number",
  "phone_number",
  "phonenumber",
  "contact",
  "contact_no",
  "contact_number",
  "buyer_mobile",
  "buyer_phone",
];
const NAME_KEYS = ["name", "full_name", "fullname", "buyer_name", "customer_name", "contact_name", "client_name"];
const CITY_KEYS = ["city", "town"];
const LOCALITY_KEYS = ["locality", "area", "location", "project_location"];
const BHK_KEYS = ["bhk", "configuration", "typology", "unit_type"];
const BUDGET_KEYS = ["budget", "price", "budget_band"];

function keyOf(key: string) {
  return key.toLowerCase().replace(/[\s-]+/g, "_");
}

function pick(record: Record<string, unknown>, keys: string[]): string {
  for (const [raw, value] of Object.entries(record)) {
    if (!keys.includes(keyOf(raw))) continue;
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectRecords(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.flatMap(collectRecords);
  const record = asRecord(body);
  if (!record) return [];
  const nested = record.leads ?? record.lead ?? record.data ?? record.payload ?? record.buyer;
  if (nested && nested !== body) {
    const inner = collectRecords(nested);
    if (inner.length) return inner;
  }
  return [record];
}

export function sourceLabel(raw: string | undefined): string {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return "Inquiry";
  if (text.includes("99")) return "99acres";
  if (text.includes("magic")) return "Magicbricks";
  if (text.includes("housing")) return "Housing.com";
  if (text.includes("facebook") || text.includes("meta") || text.includes("instagram")) return "Facebook";
  if (text.includes("google")) return "Google";
  return raw!.trim().slice(0, 40);
}

export function leadsFromPayload(body: unknown, sourceHint?: string): InboundLead[] {
  const out: InboundLead[] = [];
  for (const record of collectRecords(body)) {
    const phone = normalizeIndiaPhone(pick(record, PHONE_KEYS));
    if (!phone) continue;
    const hinted = sourceHint || pick(record, ["source", "portal", "source_type", "lead_source", "platform"]);
    const name = pick(record, NAME_KEYS);
    out.push({
      phone,
      name: name || undefined,
      source: sourceLabel(hinted),
      city: pick(record, CITY_KEYS) || undefined,
      locality: pick(record, LOCALITY_KEYS) || undefined,
      bhk: pick(record, BHK_KEYS) || undefined,
      budget: pick(record, BUDGET_KEYS) || undefined,
    });
  }
  return out;
}

export function facebookFieldsToLead(fieldData: unknown): InboundLead | null {
  if (!Array.isArray(fieldData)) return null;
  const record: Record<string, unknown> = {};
  for (const field of fieldData) {
    const row = asRecord(field);
    if (!row) continue;
    const name = String(row.name ?? "");
    const values = Array.isArray(row.values) ? row.values : [];
    if (name && values.length) record[name] = values[0];
  }
  return leadsFromPayload(record, "facebook")[0] ?? null;
}
