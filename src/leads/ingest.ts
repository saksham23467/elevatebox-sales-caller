import { config, toE164 } from "../config.ts";
import { canDial, impliedConsent } from "../compliance/calling.ts";
import type { Playbook } from "../packs/types.ts";
import { store, type CampaignRecord, type LeadRecord } from "../store.ts";
import { normalizeIndiaPhone, parseLeadCsv, type CsvReject, type ParsedLead } from "./csv.ts";
import { leadsFromPayload, type InboundLead } from "./inbound.ts";

export type IngestBody = {
  phone?: string;
  to?: string;
  name?: string;
  source?: string;
  consentSource?: string;
  consent_source?: string;
  playbook?: Playbook;
  campaignId?: string;
  projectId?: string;
  city?: string;
  locality?: string;
  bhk?: string;
  budget?: string;
  leads?: IngestBody[];
};

function newLeadId(phone: string, tag: string, index: number): string {
  return `lead-${phone.replace(/\D/g, "")}-${tag}-${index}`;
}

function writeLead(body: IngestBody, tag: string, index: number, ingestedAt?: string): LeadRecord {
  const raw = String(body.phone ?? body.to ?? "");
  const phone = normalizeIndiaPhone(raw) ?? toE164(raw);
  if (!phone || phone === "+" || phone.length < 12) throw new Error("phone is required");
  const playbook: Playbook = body.playbook === "campaign" ? "campaign" : "speed";
  const consentSource = impliedConsent(body.source, body.consentSource ?? body.consent_source);
  const id = newLeadId(phone, tag, index);
  const gate = canDial({ phone, consentSource, playbook });
  const status = gate.ok ? "queued" : gate.reason;
  const lead = store.upsertLead({
    id,
    phone,
    name: body.name?.trim() || undefined,
    source: body.source?.trim() || undefined,
    consentSource,
    playbook,
    campaignId: body.campaignId,
    projectId: body.projectId ?? (config.vertical === "real-estate" ? "aarav-greens" : undefined),
    city: body.city,
    locality: body.locality,
    bhk: body.bhk,
    budget: body.budget,
    status,
    skipReason: gate.ok ? undefined : gate.reason,
    ingestedAt,
  });
  store.log("lead_in", `${phone} ${lead.status} via ${consentSource}`, id);
  return lead;
}

function seenRecently(phone: string, hours = 12): boolean {
  const cutoff = Date.now() - hours * 3_600_000;
  return store.all().leads.some((lead) => lead.phone === phone && new Date(lead.ingestedAt).getTime() >= cutoff);
}

export function ingestInbound(body: unknown, sourceHint?: string): { imported: LeadRecord[]; skipped: number } {
  const parsed = leadsFromPayload(body, sourceHint);
  const imported: LeadRecord[] = [];
  let skipped = 0;
  const tag = `in-${Date.now()}`;
  parsed.forEach((row, index) => {
    if (store.phonesBusy().has(row.phone) || seenRecently(row.phone)) {
      skipped += 1;
      return;
    }
    imported.push(writeInbound(row, tag, index));
  });
  return { imported, skipped };
}

function writeInbound(row: InboundLead, tag: string, index: number): LeadRecord {
  return writeLead(
    {
      phone: row.phone,
      name: row.name,
      source: row.source,
      consentSource: row.source,
      playbook: "speed",
      city: row.city,
      locality: row.locality,
      bhk: row.bhk,
      budget: row.budget,
    },
    tag,
    index,
  );
}

export function ingestLeads(body: IngestBody): LeadRecord[] {
  const many = Array.isArray(body.leads) && body.leads.length ? body.leads : [body];
  const tag = String(Date.now());
  return many.map((item, index) => writeLead(item, tag, index));
}

export type CampaignIngest = {
  campaign: CampaignRecord;
  leads: LeadRecord[];
  rejected: CsvReject[];
  unnamed: number;
  skippedBusy: number;
};

export function ingestCampaignCsv(opts: {
  csv: string;
  filename?: string;
  start?: boolean;
}): CampaignIngest {
  const parsed = parseLeadCsv(opts.csv);
  const filename = (opts.filename ?? "leads.csv").replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 80) || "leads.csv";
  const campaignId = `camp-${Date.now()}`;
  const busy = store.phonesBusy();
  const extraDupes: CsvReject[] = [];
  const accepted: ParsedLead[] = [];

  for (const row of parsed.rows) {
    if (busy.has(row.phone)) {
      extraDupes.push({ line: row.line, reason: "duplicate", raw: row.phone, phone: row.phone });
      continue;
    }
    accepted.push(row);
    busy.add(row.phone);
  }

  const campaign = store.upsertCampaign({
    id: campaignId,
    filename,
    status: "draft",
    total: accepted.length,
    invalid: parsed.rejected.filter((r) => r.reason !== "duplicate").length,
    duplicates: parsed.rejected.filter((r) => r.reason === "duplicate").length + extraDupes.length,
  });

  const base = Date.now();
  const leads = accepted.map((row, index) =>
    writeLead(
      {
        phone: row.phone,
        name: row.name,
        city: row.city,
        locality: row.locality,
        bhk: row.bhk,
        budget: row.budget,
        source: row.source || filename,
        consentSource: "csv_import",
        playbook: "campaign",
        campaignId,
      },
      campaignId,
      index,
      new Date(base + index).toISOString(),
    ),
  );

  if (opts.start && leads.some((l) => l.status === "queued" || l.status === "outside_hours")) {
    store.startCampaign(campaignId);
  }

  store.log("campaign_in", `${filename} ${accepted.length} numbers`, campaignId);
  return {
    campaign: store.getCampaign(campaignId) ?? campaign,
    leads,
    rejected: [...parsed.rejected, ...extraDupes],
    unnamed: accepted.filter((r) => !r.name).length,
    skippedBusy: extraDupes.length,
  };
}
