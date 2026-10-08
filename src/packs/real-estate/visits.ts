import { formatIst } from "../../schedule/parseTime.ts";
import { VISIT_SLOTS } from "./project.ts";

const IST = "Asia/Kolkata";

function istParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
  };
}

function atIst(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30));
}

function addDays(year: number, month: number, day: number, n: number) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function isWeekend(weekday: string) {
  return weekday === "Sat" || weekday === "Sun";
}

/** Snap a spoken time onto the next RM slot the agent is allowed to promise. */
export function snapToVisitSlot(spokenAt: Date, now = new Date()): { at: Date; label: string } {
  const target = spokenAt.getTime() < now.getTime() + 30 * 60 * 1000 ? new Date(now.getTime() + 60 * 60 * 1000) : spokenAt;
  const p = istParts(target);
  const weekend = isWeekend(p.weekday);

  const sameDay = VISIT_SLOTS.filter((s) => {
    if (s.weekendOnly && !weekend) return false;
    if (s.weekdayOnly && weekend) return false;
    return s.hour >= p.hour;
  });

  if (sameDay.length) {
    const slot = sameDay.sort((a, b) => Math.abs(a.hour - p.hour) - Math.abs(b.hour - p.hour))[0];
    const at = atIst(p.year, p.month, p.day, slot.hour);
    if (at.getTime() > now.getTime()) return { at, label: `${formatIst(at)} (${slot.label})` };
  }

  for (let i = 1; i <= 7; i++) {
    const next = addDays(p.year, p.month, p.day, i);
    const probe = atIst(next.year, next.month, next.day, 12);
    const w = istParts(probe).weekday;
    const we = isWeekend(w);
    const slot = VISIT_SLOTS.find((s) => {
      if (s.weekendOnly && !we) return false;
      if (s.weekdayOnly && we) return false;
      return true;
    });
    if (!slot) continue;
    const at = atIst(next.year, next.month, next.day, slot.hour);
    return { at, label: `${formatIst(at)} (${slot.label})` };
  }

  const fallback = atIst(p.year, p.month, p.day + 1, 11);
  return { at: fallback, label: formatIst(fallback) };
}
