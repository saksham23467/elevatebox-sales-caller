import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toE164 } from "./config.ts";
import type { LeadClass, Qualification } from "./qualify/classify.ts";

export type CallRecord = {
  id: string;
  to: string;
  status: "dialing" | "in_progress" | "completed" | "failed";
  language?: string;
  classification?: LeadClass;
  qualification?: Qualification;
  whatsappMidSentAt?: string;
  whatsappFollowupSentAt?: string;
  callbackAt?: string;
  callbackSpoken?: string;
  transcript?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoreShape = {
  calls: CallRecord[];
  events: Array<{ at: string; callId?: string; type: string; detail: string }>;
};

const file = join(dirname(fileURLToPath(import.meta.url)), "../data/store.json");

function empty(): StoreShape {
  return { calls: [], events: [] };
}

function load(): StoreShape {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as StoreShape;
  } catch {
    return empty();
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
    data.calls = data.calls.slice(0, 100);
    save(data);
    return created;
  },
  getCall(id: string): CallRecord | undefined {
    return load().calls.find((c) => c.id === id);
  },
  latestCall(): CallRecord | undefined {
    return load().calls[0];
  },
  dueCallbacks(now = new Date()): CallRecord[] {
    return load().calls.filter(
      (c) => c.callbackAt && new Date(c.callbackAt).getTime() <= now.getTime() && c.status !== "dialing",
    );
  },
  whatsAppAlreadySent(to: string, withinMs = 10 * 60 * 1000): boolean {
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
};
