import * as chrono from "chrono-node";

const IST = "Asia/Kolkata";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function formatIst(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${parts} IST`;
}

function atHour(date: Date, hour: number, minute = 0): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 5, minute - 30));
}

const HINDI_TE: Array<[RegExp, string]> = [
  [/\bkal subah\b/i, "tomorrow morning"],
  [/\bkal shaam\b/i, "tomorrow evening"],
  [/\bkal\b/i, "tomorrow"],
  [/\bparso\b/i, "day after tomorrow"],
  [/\bsubah\b/i, "morning"],
  [/\bshaam\b/i, "evening"],
  [/\bdopahar\b/i, "afternoon"],
  [/\brep[uo]\b/i, "tomorrow"],
];

export function parseSpokenTime(spoken: string, now = new Date()): { at: Date; spoken: string } | null {
  const raw = spoken.trim();
  if (!raw) return null;
  let text = raw;
  for (const [re, en] of HINDI_TE) text = text.replace(re, en);

  if (/tomorrow morning|kal subah|next morning/i.test(raw + text)) {
    const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return { at: atHour(d, 10), spoken: raw };
  }
  if (/tomorrow evening|kal shaam/i.test(raw + text)) {
    const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return { at: atHour(d, 18), spoken: raw };
  }
  if (/this evening|aaj shaam/i.test(raw + text)) {
    return { at: atHour(now, 18), spoken: raw };
  }
  if (/next week/i.test(raw + text)) {
    const d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { at: atHour(d, 10), spoken: raw };
  }

  const parsed = chrono.parseDate(text, now, { forwardDate: true });
  if (!parsed) return null;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hour12: false }).format(parsed),
  );
  const minute = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: IST, minute: "2-digit" }).format(parsed),
  );
  if (hour === 0 && minute === 0 && !/\d/.test(text)) {
    return { at: atHour(parsed, 10), spoken: raw };
  }
  return { at: parsed, spoken: raw };
}

export function iso(date: Date): string {
  return date.toISOString();
}

export function stamp(date: Date): string {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return s.replace(",", "");
}

export { pad };
