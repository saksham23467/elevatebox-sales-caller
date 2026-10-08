import { config } from "../config.ts";
import type { Market, Playbook } from "../packs/types.ts";
import { store } from "../store.ts";

/** TRAI PE-TM window. US TCPA-style 8–21 local is the later adapter. */
const WINDOWS: Record<Market, { startHour: number; endHour: number; tz: string }> = {
  india: { startHour: 9, endHour: 21, tz: "Asia/Kolkata" },
  us: { startHour: 8, endHour: 21, tz: process.env.US_TZ?.trim() || "America/New_York" },
};

function hourInZone(now: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now));
}

export function isWithinCallingHours(now = new Date(), market: Market = config.market): boolean {
  if (config.allowAfterHours) return true;
  const w = WINDOWS[market];
  const hour = hourInZone(now, w.tz);
  return hour >= w.startHour && hour < w.endHour;
}

export type DialBlock =
  | { ok: true }
  | { ok: false; reason: "dnd" | "outside_hours" | "no_consent" | "opted_out" };

export function canDial(opts: {
  phone: string;
  consentSource?: string;
  playbook?: Playbook;
  now?: Date;
}): DialBlock {
  if (store.isDnd(opts.phone)) return { ok: false, reason: "dnd" };
  if (!isWithinCallingHours(opts.now ?? new Date(), config.market)) return { ok: false, reason: "outside_hours" };
  const playbook = opts.playbook ?? "speed";
  if (playbook === "campaign" && !opts.consentSource) return { ok: false, reason: "no_consent" };
  return { ok: true };
}

export function impliedConsent(source?: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (source?.trim()) return source.trim();
  return "inquiry";
}
