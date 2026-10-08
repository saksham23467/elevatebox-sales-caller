import { sendPacket } from "../adapters/messaging.ts";
import { config, toE164 } from "../config.ts";
import { pack } from "../packs/active.ts";
import { snapToVisitSlot } from "../packs/real-estate/visits.ts";
import { parseSpokenTime, formatIst } from "../schedule/parseTime.ts";
import { store } from "../store.ts";
import type { Lang } from "../whatsapp/copy.ts";

import type { Qualification } from "../qualify/classify.ts";

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

const sendingTo = new Set<string>();

function packetLang(q: Qualification): Lang {
  if (q.language === "hi" || q.language === "te") return q.language;
  return "en";
}

function spokenWhatsAppConfirm(lang: Lang): string {
  if (lang === "hi") return "WhatsApp pe number ja raha hai. Phone dekho.";
  if (lang === "te") return "WhatsApp lo number pampistunnanu. Phone choodandi.";
  return "Sending it on WhatsApp. Glance at your phone.";
}

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

const VOICEMAIL_SPEECH =
  /leave (?:a |your )?message after|after the (?:beep|tone)|you have reached|please record your (?:message|name)|mailbox (?:is )?(?:full|not)|answering machine|\bvoicemail\b|the person you (?:have )?called|unable to take your call|tone ke baad|beep ke baad|sandesh chhod|message record cheyandi/i;

export function looksLikeVoicemailSpeech(text: unknown): boolean {
  const s = String(text ?? "");
  return s.length >= 8 && VOICEMAIL_SPEECH.test(s);
}

export function isVoicemailPayload(raw: ToolBody): boolean {
  const b = flatten(raw);
  const report = (b.call_report && typeof b.call_report === "object" ? b.call_report : {}) as ToolBody;
  if (
    [b.is_voicemail, b.amd_detected, b.voicemail_detected, report.is_voicemail, report.amd_detected].some(boolish)
  ) {
    return true;
  }
  const status = String(
    b.call_status ??
      b.status ??
      b.ended_reason ??
      b.endedReason ??
      b.hangup_reason ??
      b.end_reason ??
      report.call_status ??
      report.status ??
      "",
  );
  return /voicemail|answering[_-]?machine|machine_detected/i.test(status);
}

function flatten(body: ToolBody): ToolBody {
  const nested = body.parameters ?? body.data ?? body.extracted_variables ?? body.call_metadata ?? body.metadata;
  const call = body.call && typeof body.call === "object" ? (body.call as ToolBody) : undefined;
  const customer = call?.customer && typeof call.customer === "object" ? (call.customer as ToolBody) : undefined;
  return {
    ...body,
    ...(call ?? {}),
    ...(customer ?? {}),
    ...(nested && typeof nested === "object" ? (nested as ToolBody) : {}),
  };
}

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function isOurDid(value: string): boolean {
  const n = toE164(value);
  if (!n || n === "+") return false;
  const ours = [config.omnidimPhoneNumber].filter(Boolean).map(toE164);
  return ours.includes(n);
}

function pickCaller(raw: ToolBody): string | undefined {
  const b = flatten(raw);
  return [b.from_number, b.from, b.caller_number, b.caller, b.customer_number, b.user_number]
    .map((v) => str(v))
    .find((v) => v && looksLikePhone(v) && !isOurDid(v));
}

function inboundHint(raw: ToolBody): boolean {
  const b = flatten(raw);
  const blob = `${b.call_direction ?? ""} ${b.direction ?? ""} ${b.call_type ?? ""} ${b.bot_call_type ?? ""} ${b.type ?? ""}`;
  if (/inbound|incoming/i.test(blob)) return true;
  const toNum = str(b.to_number ?? (typeof b.to === "string" ? b.to : undefined));
  return Boolean(toNum && isOurDid(toNum) && pickCaller(raw));
}

/** Persist the human on an inbound PSTN call. `to` on CallRecord stays their number, not our DID. */
export function registerIncomingCall(opts: {
  callId: string;
  from?: string;
  provider?: "omnidim" | "vapi";
}): string | undefined {
  const human = opts.from && looksLikePhone(opts.from) && !isOurDid(opts.from) ? toE164(opts.from) : undefined;
  if (!human || human === "+") return undefined;
  const existing = store.getCall(opts.callId);
  store.upsertCall({
    id: opts.callId,
    to: human,
    direction: "inbound",
    status: existing?.status === "completed" ? existing.status : "in_progress",
    provider: opts.provider ?? existing?.provider,
    remoteId: existing?.remoteId ?? opts.callId,
  });
  if (!existing || existing.direction !== "inbound") {
    store.log("inbound", `answered ${human}`, opts.callId);
  }
  return human;
}

/** Keep the human's number on the call so WhatsApp and the LCD work for inbound too. */
export function rememberCallParty(raw: ToolBody, callId: string): string {
  const existing = store.getCall(callId);
  const live = existing ?? store.liveCall();
  const from = pickCaller(raw);
  const inbound =
    existing?.direction === "inbound" ||
    inboundHint(raw) ||
    Boolean(!live && from);
  if (inbound && from) {
    return registerIncomingCall({ callId, from }) ?? from;
  }
  if (existing?.to && !isOurDid(existing.to)) return toE164(existing.to);
  try {
    return resolveCallee(raw, callId);
  } catch {
    return existing?.to ?? "";
  }
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
  if (stored && !isOurDid(stored)) return toE164(stored);

  const from = pickCaller(raw);
  if (from) return toE164(from);

  const b = flatten(raw);
  const unique = [
    ...new Set(
      [b.customer_number, b.customer_phone, b.user_number, b.phone, b.phone_number, b.to, ...phonesIn(raw)]
        .map((v) => str(v))
        .filter((v): v is string => Boolean(v))
        .filter((v) => !isOurDid(v))
        .map(toE164),
    ),
  ];
  if (unique.length >= 1) return unique[0];
  throw new Error("No callee number on this call");
}

export function qualificationFromBody(raw: ToolBody): Qualification {
  const b = flatten(raw);
  const vertical = pack();
  return vertical.mergeQualification(
    vertical.classifyLead({
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
      bhk: str(b.bhk),
      locality: str(b.locality ?? b.area),
      endUse: str(b.end_use ?? b.endUse),
      catalogSize: str(b.catalog_size ?? b.catalogSize ?? b.products_count),
    }),
    {
      catalogSize: str(b.catalog_size ?? b.catalogSize ?? b.products_count),
      bhk: str(b.bhk),
      locality: str(b.locality ?? b.area),
      endUse: str(b.end_use ?? b.endUse),
      budget: str(b.budget),
      timeline: str(b.timeline),
      barrier: str(b.barrier),
    },
  );
}

export async function handleClassify(raw: ToolBody) {
  const callId = str(raw.call_id ?? raw.callId) ?? store.latestCall()?.id ?? `live-${Date.now()}`;
  const to = rememberCallParty(raw, callId);
  const q = qualificationFromBody(raw);
  const rec = store.upsertCall({
    id: callId,
    status: "in_progress",
    to,
    language: str(raw.language) ?? q.language,
    classification: q.classification,
    qualification: q,
  });
  store.log("classify", `${q.classification}: ${q.reasons.join("; ")}`, callId);
  const lang = packetLang(q);
  let say: string | undefined;
  if (q.classification === "hot") {
    void handleSendWhatsApp({ ...raw, call_id: callId, force: false }).catch((err) => {
      store.log("whatsapp_mid_fail", err instanceof Error ? err.message : String(err), callId);
    });
    say = spokenWhatsAppConfirm(lang);
  }
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
    language: lang,
    say,
  };
}

export async function handleSendWhatsApp(raw: ToolBody) {
  const started = Date.now();
  const callId = str(raw.call_id ?? raw.callId) ?? store.latestCall()?.id ?? `live-${Date.now()}`;
  const q = qualificationFromBody(raw);
  const to = rememberCallParty(raw, callId);
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
    const vertical = pack();
    const result = await sendPacket({
      to,
      text: vertical.midCallMessage(q),
      q,
      kind: q.visitAt ? "visit" : "mid",
      lang: packetLang(q),
      includeArchitecture: Boolean(vertical.packetAttachments.architecture),
      visitLabel: q.visitAt,
    });
    if (result.sent) {
      store.upsertCall({ id: callId, whatsappMidSentAt: new Date().toISOString() });
      store.markWhatsAppSent(to, "mid");
      store.log("whatsapp_mid", `sent to ${to}`, callId);
    } else if (result.ok) {
      store.log("whatsapp_skip", result.error ?? "not sent", callId);
    } else {
      store.log("whatsapp_mid_fail", result.error ?? "unknown", callId);
    }
    return {
      ok: result.ok,
      sent: Boolean(result.sent),
      error: result.error,
      classification: q.classification,
      ms: Date.now() - started,
      to,
      language: packetLang(q),
      say: result.sent ? spokenWhatsAppConfirm(packetLang(q)) : undefined,
    };
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
  const to = rememberCallParty(raw, callId);
  const vertical = pack();
  const wantsVisit =
    vertical.bookVisit && !/call back|callback|phone pe|phone par|ring/i.test(spoken);
  const slot = wantsVisit ? snapToVisitSlot(parsed.at) : null;
  const at = slot?.at ?? parsed.at;
  store.upsertCall({
    id: callId,
    status: "in_progress",
    to,
    callbackAt: wantsVisit ? undefined : at.toISOString(),
    visitAt: wantsVisit ? at.toISOString() : undefined,
    callbackSpoken: spoken,
    qualification: {
      ...(store.getCall(callId)?.qualification ?? qualificationFromBody(raw)),
      visitAt: wantsVisit ? slot?.label ?? formatIst(at) : undefined,
    },
  });
  const leadId = store.getCall(callId)?.leadId;
  if (leadId && wantsVisit) store.upsertLead({ id: leadId, visitAt: at.toISOString() });
  store.log(wantsVisit ? "visit" : "callback", `${spoken} → ${slot?.label ?? formatIst(at)}`, callId);
  return {
    ok: true,
    kind: wantsVisit ? "visit" : "callback",
    spoken,
    iso: at.toISOString(),
    confirm_text: slot?.label ?? formatIst(at),
  };
}

export async function handleFollowUp(opts: {
  callId: string;
  to: string;
  q: Qualification;
  transcript?: string;
  voicemail?: boolean;
}) {
  const existing = store.getCall(opts.callId);
  const to = toE164(existing?.to || opts.to);
  const voicemail = opts.voicemail || existing?.voicemail || looksLikeVoicemailSpeech(opts.transcript) || undefined;
  store.upsertCall({
    id: opts.callId,
    to,
    status: "completed",
    voicemail,
    classification: existing?.classification ?? opts.q.classification,
    qualification: existing?.qualification ?? opts.q,
    transcript: opts.transcript,
  });
  if (voicemail) {
    store.log("call_logged", `voicemail ${to} — no WhatsApp`, opts.callId);
    return { ok: true, sent: false, reason: "voicemail" };
  }
  const midAlready = Boolean(existing?.whatsappMidSentAt) || store.whatsAppAlreadySent(to);
  if (existing?.whatsappFollowupSentAt || midAlready || !claimWhatsAppSend(to)) {
    store.log("whatsapp_skip", `follow-up skipped, already sent to ${to}`, opts.callId);
    return { ok: true, skipped: true };
  }
  try {
    const q = opts.q;
    const vertical = pack();
    const visitAt = existing?.visitAt ? new Date(existing.visitAt) : undefined;
    const text =
      q.classification === "cold" && !q.products && !q.budget && !q.locality
        ? vertical.coldBrochure(q)
        : vertical.followUpMessage(q, {
            callbackAt: existing?.callbackAt ? new Date(existing.callbackAt) : undefined,
            visitAt,
            midCallAlready: midAlready,
          });
    const result = await sendPacket({
      to,
      text,
      q,
      kind: visitAt ? "visit" : "followup",
      lang: packetLang(q),
      includeArchitecture: !midAlready && Boolean(vertical.packetAttachments.architecture),
      visitLabel: existing?.qualification?.visitAt,
      force: !existing?.whatsappMidSentAt,
    });
    if (result.sent) {
      store.upsertCall({ id: opts.callId, to, whatsappFollowupSentAt: new Date().toISOString(), status: "completed" });
      store.markWhatsAppSent(to, "followup");
      store.log("whatsapp_followup", `sent to ${to}`, opts.callId);
    } else if (result.ok) {
      store.log("whatsapp_skip", result.error ?? "follow-up not sent", opts.callId);
    } else {
      store.log("whatsapp_followup_fail", result.error ?? "unknown", opts.callId);
    }
    return result;
  } finally {
    releaseWhatsAppSend(to);
  }
}
