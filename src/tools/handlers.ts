import { toE164 } from "../config.ts";
import { classifyLead, mergeCatalog, type Qualification } from "../qualify/classify.ts";
import { parseSpokenTime, formatIst } from "../schedule/parseTime.ts";
import { store } from "../store.ts";
import { sendWhatsApp } from "../whatsapp/client.ts";
import { coldBrochure, followUpMessage, langOf, midCallMessage } from "../whatsapp/copy.ts";

export type ToolBody = Record<string, unknown>;

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function boolish(v: unknown): boolean {
  if (v === true) return true;
  return /true|yes|1/i.test(String(v ?? ""));
}

function flatten(body: ToolBody): ToolBody {
  const nested = body.parameters ?? body.data ?? body.extracted_variables ?? body.call_metadata ?? body.metadata;
  if (nested && typeof nested === "object") return { ...body, ...(nested as ToolBody) };
  return body;
}

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

/** Blocks mid-call + hangup (and double tool fires) from both sending. */
const sendingTo = new Set<string>();

function claimWhatsAppSend(to: string): boolean {
  const e164 = toE164(to);
  if (!e164 || e164 === "+") return false;
  if (sendingTo.has(e164) || store.whatsAppAlreadySent(e164)) return false;
  sendingTo.add(e164);
  return true;
}

function releaseWhatsAppSend(to: string) {
  sendingTo.delete(toE164(to));
}

function phonesIn(obj: unknown, out: string[] = [], depth = 0): string[] {
  if (!obj || depth > 4) return out;
  if (typeof obj === "string" && looksLikePhone(obj)) out.push(obj);
  if (typeof obj !== "object") return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (
      typeof value === "string" &&
      looksLikePhone(value) &&
      /phone|number|to|from|customer|callee|destination|user/i.test(key)
    ) {
      out.push(value);
    } else if (value && typeof value === "object") {
      phonesIn(value, out, depth + 1);
    }
  }
  return out;
}

/** WhatsApp the person on this call, never a hardcoded hiring number. */
export function resolveCallee(raw: ToolBody, callId?: string): string {
  const stored =
    (callId ? store.getCall(callId)?.to : undefined) ||
    store.all().calls.find((c) => c.status === "in_progress" || c.status === "dialing")?.to ||
    store.latestCall()?.to;
  if (stored) return toE164(stored);

  const b = flatten(raw);
  const unique = [
    ...new Set(
      [b.customer_number, b.customer_phone, b.user_number, b.phone, b.phone_number, b.to, ...phonesIn(raw)]
        .map((v) => str(v))
        .filter((v): v is string => Boolean(v))
        .map(toE164),
    ),
  ];
  if (unique.length >= 1) return unique[0];
  throw new Error("No callee number on this call — cannot send WhatsApp");
}

export function qualificationFromBody(raw: ToolBody): Qualification {
  const b = flatten(raw);
  return mergeCatalog(
    classifyLead({
      agentLabel: str(b.classification ?? b.intent ?? b.label),
      utterances: str(b.utterances ?? b.transcript ?? b.evidence),
      budget: str(b.budget),
      products: str(b.products ?? b.what_they_sell),
      timeline: str(b.timeline),
      features: str(b.features),
      barrier: str(b.barrier),
      quotes: str(b.quotes ?? b.evidence)
        ?.split(/\n|\|/)
        .map((x) => x.replace(/^["“]|["”]$/g, "").trim())
        .filter(Boolean),
      askedForDetails: b.asked_for_details != null ? String(b.asked_for_details) : b.send_whatsapp != null ? String(b.send_whatsapp) : undefined,
      language: str(b.language),
    }),
    str(b.catalog_size ?? b.catalogSize ?? b.products_count),
  );
}

export async function handleClassify(raw: ToolBody) {
  const callId = str(raw.call_id ?? raw.callId) ?? store.latestCall()?.id ?? `live-${Date.now()}`;
  const q = qualificationFromBody(raw);
  const rec = store.upsertCall({
    id: callId,
    status: "in_progress",
    to: resolveCallee(raw, callId),
    language: str(raw.language) ?? q.language,
    classification: q.classification,
    qualification: q,
  });
  store.log("classify", `${q.classification}: ${q.reasons.join("; ")}`, callId);
  return {
    ok: true,
    call_id: rec.id,
    classification: q.classification,
    action:
      q.classification === "hot"
        ? "send_whatsapp_now"
        : q.classification === "warm"
          ? "capture_barrier_and_schedule"
          : "log_and_brochure_after_call",
    reasons: q.reasons,
  };
}

export async function handleSendWhatsApp(raw: ToolBody) {
  const started = Date.now();
  const callId = str(raw.call_id ?? raw.callId) ?? store.latestCall()?.id ?? `live-${Date.now()}`;
  const q = qualificationFromBody(raw);
  const to = resolveCallee(raw, callId);
  store.upsertCall({
    id: callId,
    status: "in_progress",
    to,
    classification: q.classification,
    qualification: q,
  });

  const force = boolish(raw.force);
  if (q.classification !== "hot" && !force) {
    store.log("whatsapp_skip", `not hot (${q.classification})`, callId);
    return { ok: true, sent: false, reason: "not_hot", classification: q.classification, ms: Date.now() - started };
  }
  if (!claimWhatsAppSend(to)) {
    store.log("whatsapp_skip", `already sent to ${to}`, callId);
    return { ok: true, sent: false, reason: "already_sent", to, ms: Date.now() - started };
  }

  try {
    const result = await sendWhatsApp({
      to,
      text: midCallMessage(q),
      includeArchitecture: true,
      includeResume: true,
      lang: langOf(q),
    });
    if (result.ok) {
      store.upsertCall({ id: callId, whatsappMidSentAt: new Date().toISOString() });
      store.markWhatsAppSent(to, "mid");
      store.log("whatsapp_mid", `sent to ${to}`, callId);
    } else {
      store.log("whatsapp_mid_fail", result.error ?? "unknown", callId);
    }
    return { ok: result.ok, sent: result.ok, error: result.error, classification: q.classification, ms: Date.now() - started, to };
  } finally {
    releaseWhatsAppSend(to);
  }
}

export async function handleBookCallback(raw: ToolBody) {
  const callId = str(raw.call_id ?? raw.callId) ?? store.latestCall()?.id ?? `live-${Date.now()}`;
  const spoken = str(raw.spoken_time ?? raw.time ?? raw.when) ?? "";
  const parsed = parseSpokenTime(spoken);
  if (!parsed) {
    store.log("callback_fail", `could not parse: ${spoken}`, callId);
    return { ok: false, error: "unparsed", spoken };
  }
  const to = resolveCallee(raw, callId);
  store.upsertCall({
    id: callId,
    status: "in_progress",
    to,
    callbackAt: parsed.at.toISOString(),
    callbackSpoken: spoken,
  });
  store.log("callback", `${spoken} → ${formatIst(parsed.at)}`, callId);
  return {
    ok: true,
    spoken,
    iso: parsed.at.toISOString(),
    confirm_text: formatIst(parsed.at),
  };
}

export async function handleFollowUp(opts: { callId: string; to: string; q: Qualification; transcript?: string }) {
  const existing = store.getCall(opts.callId);
  const to = toE164(existing?.to || opts.to);
  const midAlready = Boolean(existing?.whatsappMidSentAt) || store.whatsAppAlreadySent(to);
  if (existing?.whatsappFollowupSentAt || midAlready || !claimWhatsAppSend(to)) {
    store.log("whatsapp_skip", `follow-up skipped, already sent to ${to}`, opts.callId);
    return { ok: true, skipped: true };
  }
  try {
    const q = opts.q;
    const text =
      q.classification === "cold" && !q.products && !q.budget
        ? coldBrochure(q)
        : followUpMessage(q, {
            callbackAt: existing?.callbackAt ? new Date(existing.callbackAt) : undefined,
            midCallAlready: midAlready,
          });
    const result = await sendWhatsApp({
      to,
      text,
      includeArchitecture: !midAlready,
      includeResume: true,
      lang: langOf(q),
    });
    if (result.ok) {
      store.upsertCall({ id: opts.callId, to, whatsappFollowupSentAt: new Date().toISOString(), status: "completed" });
      store.markWhatsAppSent(to, "followup");
      store.log("whatsapp_followup", `sent to ${to}`, opts.callId);
    } else {
      store.log("whatsapp_followup_fail", result.error ?? "unknown", opts.callId);
    }
    return result;
  } finally {
    releaseWhatsAppSend(to);
  }
}
