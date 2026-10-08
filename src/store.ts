import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toE164 } from "./config.ts";
import { upsertCallRow } from "./calls/sheet.ts";
import type { Playbook } from "./packs/types.ts";
import type { LeadClass, Qualification } from "./qualify/classify.ts";

export type CallRecord = {
  id: string;
  to: string;
  provider?: "omnidim" | "vapi";
  remoteId?: string;
  leadId?: string;
  status: "dialing" | "in_progress" | "completed" | "failed";
  language?: string;
  classification?: LeadClass;
  qualification?: Qualification;
  whatsappMidSentAt?: string;
  whatsappFollowupSentAt?: string;
  callbackAt?: string;
  callbackSpoken?: string;
  visitAt?: string;
  direction?: "inbound" | "outbound";
  transcript?: string;
  summary?: string;
  voicemail?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LeadStatus =
  | "queued"
  | "skipped"
  | "dialing"
  | "completed"
  | "failed"
  | "dnd"
  | "outside_hours"
  | "no_consent"
  | "opted_out";

export type LeadRecord = {
  id: string;
  phone: string;
  name?: string;
  source?: string;
  consentSource: string;
  playbook: Playbook;
  campaignId?: string;
  projectId?: string;
  city?: string;
  locality?: string;
  bhk?: string;
  budget?: string;
  status: LeadStatus;
  skipReason?: string;
  ingestedAt: string;
  firstRingAt?: string;
  waitMs?: number;
  lastCallId?: string;
  visitAt?: string;
  walkedInAt?: string;
  updatedAt: string;
};

export type CampaignStatus = "draft" | "running" | "paused" | "done";

export type CampaignRecord = {
  id: string;
  filename: string;
  createdAt: string;
  updatedAt: string;
  status: CampaignStatus;
  total: number;
  invalid: number;
  duplicates: number;
};

export type StoreShape = {
  calls: CallRecord[];
  leads: LeadRecord[];
  campaigns: CampaignRecord[];
  dnd: string[];
  events: Array<{ at: string; callId?: string; type: string; detail: string }>;
};

const file = join(dirname(fileURLToPath(import.meta.url)), "../data/store.json");

const CALL_CAP = 4000;
const LEAD_CAP = 8000;
const CAMPAIGN_CAP = 40;

function empty(): StoreShape {
  return { calls: [], leads: [], campaigns: [], dnd: [], events: [] };
}

function load(): StoreShape {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<StoreShape>;
    return {
      calls: raw.calls ?? [],
      leads: raw.leads ?? [],
      campaigns: raw.campaigns ?? [],
      dnd: raw.dnd ?? [],
      events: raw.events ?? [],
    };
  } catch {
    return empty();
  }
}

function refreshCampaigns(data: StoreShape) {
  for (const campaign of data.campaigns) {
    if (campaign.status !== "running" && campaign.status !== "paused") continue;
    const leads = data.leads.filter((l) => l.campaignId === campaign.id);
    if (!leads.length) continue;
    const pending = leads.some(
      (l) => l.status === "queued" || l.status === "dialing" || l.status === "outside_hours",
    );
    if (!pending) campaign.status = "done";
  }
}

function save(data: StoreShape) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

export const store = {
  all(): StoreShape {
    return load();
  },
  log(type: string, detail: string, callId?: string) {
    const data = load();
    data.events.unshift({ at: new Date().toISOString(), callId, type, detail });
    data.events = data.events.slice(0, 200);
    save(data);
  },
  upsertCall(partial: Partial<CallRecord> & { id: string }): CallRecord {
    const data = load();
    const now = new Date().toISOString();
    const existing = data.calls.find((c) => c.id === partial.id);
    if (existing) {
      Object.assign(existing, partial, { updatedAt: now });
      save(data);
      upsertCallRow(existing);
      return existing;
    }
    const created: CallRecord = {
      to: partial.to ?? "",
      status: partial.status ?? "dialing",
      createdAt: now,
      updatedAt: now,
      ...partial,
      id: partial.id,
    };
    data.calls.unshift(created);
    data.calls = data.calls.slice(0, CALL_CAP);
    save(data);
    upsertCallRow(created);
    return created;
  },
  getCall(id: string): CallRecord | undefined {
    return load().calls.find((c) => c.id === id);
  },
  latestCall(): CallRecord | undefined {
    return load().calls[0];
  },
  liveCall(): CallRecord | undefined {
    return load().calls.find((c) => c.status === "dialing" || c.status === "in_progress");
  },
  dueCallbacks(now = new Date()): CallRecord[] {
    return load().calls.filter(
      (c) => c.callbackAt && !c.visitAt && new Date(c.callbackAt).getTime() <= now.getTime() && c.status !== "dialing",
    );
  },
  whatsAppAlreadySent(to: string, withinMs = 2 * 60 * 1000): boolean {
    const e164 = toE164(to);
    if (!e164 || e164 === "+") return false;
    const cutoff = Date.now() - withinMs;
    return load().calls.some((c) => {
      if (toE164(c.to || "") !== e164) return false;
      const stamps = [c.whatsappMidSentAt, c.whatsappFollowupSentAt].filter(Boolean) as string[];
      return stamps.some((at) => new Date(at).getTime() >= cutoff);
    });
  },
  markWhatsAppSent(to: string, which: "mid" | "followup") {
    const e164 = toE164(to);
    const now = new Date().toISOString();
    const data = load();
    for (const c of data.calls) {
      if (toE164(c.to || "") !== e164) continue;
      if (which === "mid") c.whatsappMidSentAt = now;
      else c.whatsappFollowupSentAt = now;
      c.updatedAt = now;
    }
    save(data);
  },
  clearWhatsAppSent() {
    const data = load();
    const now = new Date().toISOString();
    for (const c of data.calls) {
      delete c.whatsappMidSentAt;
      delete c.whatsappFollowupSentAt;
      c.updatedAt = now;
    }
    save(data);
  },
  isDnd(phone: string): boolean {
    const e164 = toE164(phone);
    return load().dnd.includes(e164);
  },
  addDnd(phone: string) {
    const e164 = toE164(phone);
    const data = load();
    if (!data.dnd.includes(e164)) data.dnd.unshift(e164);
    data.dnd = data.dnd.slice(0, 2000);
    save(data);
  },
  upsertLead(partial: Partial<LeadRecord> & { id: string }): LeadRecord {
    const data = load();
    const now = new Date().toISOString();
    const existing = data.leads.find((l) => l.id === partial.id);
    if (existing) {
      Object.assign(existing, partial, { updatedAt: now });
      refreshCampaigns(data);
      save(data);
      return existing;
    }
    const created: LeadRecord = {
      phone: partial.phone ?? "",
      consentSource: partial.consentSource ?? "inquiry",
      playbook: partial.playbook ?? "speed",
      status: partial.status ?? "queued",
      ingestedAt: partial.ingestedAt ?? now,
      updatedAt: now,
      ...partial,
      id: partial.id,
    };
    data.leads.unshift(created);
    data.leads = data.leads.slice(0, LEAD_CAP);
    refreshCampaigns(data);
    save(data);
    return created;
  },
  getLead(id: string): LeadRecord | undefined {
    return load().leads.find((l) => l.id === id);
  },
  phonesBusy(): Set<string> {
    return new Set(
      load()
        .leads.filter((l) => l.status === "queued" || l.status === "dialing" || l.status === "outside_hours")
        .map((l) => l.phone),
    );
  },
  queuedLeads(): LeadRecord[] {
    const data = load();
    const running = new Set(data.campaigns.filter((c) => c.status === "running").map((c) => c.id));
    return data.leads
      .filter((l) => l.status === "queued" || l.status === "outside_hours")
      .filter((l) => !l.campaignId || running.has(l.campaignId))
      .sort((a, b) => {
        if (a.playbook !== b.playbook) return a.playbook === "speed" ? -1 : 1;
        return new Date(a.ingestedAt).getTime() - new Date(b.ingestedAt).getTime();
      });
  },
  upsertCampaign(partial: Partial<CampaignRecord> & { id: string }): CampaignRecord {
    const data = load();
    const now = new Date().toISOString();
    const existing = data.campaigns.find((c) => c.id === partial.id);
    if (existing) {
      Object.assign(existing, partial, { updatedAt: now });
      refreshCampaigns(data);
      save(data);
      return existing;
    }
    const created: CampaignRecord = {
      filename: partial.filename ?? "leads.csv",
      createdAt: now,
      updatedAt: now,
      status: partial.status ?? "draft",
      total: partial.total ?? 0,
      invalid: partial.invalid ?? 0,
      duplicates: partial.duplicates ?? 0,
      ...partial,
      id: partial.id,
    };
    data.campaigns.unshift(created);
    data.campaigns = data.campaigns.slice(0, CAMPAIGN_CAP);
    save(data);
    return created;
  },
  getCampaign(id: string): CampaignRecord | undefined {
    return load().campaigns.find((c) => c.id === id);
  },
  startCampaign(id: string): CampaignRecord {
    const data = load();
    const campaign = data.campaigns.find((c) => c.id === id);
    if (!campaign) throw new Error("campaign not found");
    for (const other of data.campaigns) {
      if (other.id !== id && other.status === "running") other.status = "paused";
    }
    campaign.status = "running";
    campaign.updatedAt = new Date().toISOString();
    refreshCampaigns(data);
    save(data);
    return campaign;
  },
  pauseCampaign(id: string): CampaignRecord {
    const data = load();
    const campaign = data.campaigns.find((c) => c.id === id);
    if (!campaign) throw new Error("campaign not found");
    if (campaign.status === "running") campaign.status = "paused";
    campaign.updatedAt = new Date().toISOString();
    save(data);
    return campaign;
  },
  campaignStats(id: string) {
    const data = load();
    const campaign = data.campaigns.find((c) => c.id === id);
    const leads = data.leads.filter((l) => l.campaignId === id);
    const count = (status: LeadStatus | LeadStatus[]) =>
      leads.filter((l) => (Array.isArray(status) ? status.includes(l.status) : l.status === status)).length;
    return {
      campaign,
      queued: count(["queued", "outside_hours"]),
      dialing: count("dialing"),
      completed: count("completed"),
      failed: count("failed"),
      skipped: count(["skipped", "dnd", "no_consent", "opted_out"]),
      unnamed: leads.filter((l) => !l.name).length,
    };
  },
};
