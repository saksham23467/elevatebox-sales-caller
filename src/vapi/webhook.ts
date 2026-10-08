import { store } from "../store.ts";
import {
  handleBookCallback,
  handleClassify,
  handleFollowUp,
  handleSendWhatsApp,
  isVoicemailPayload,
  looksLikeVoicemailSpeech,
  qualificationFromBody,
  registerIncomingCall,
  type ToolBody,
} from "../tools/handlers.ts";

type VapiToolCall = {
  id?: string;
  name?: string;
  parameters?: ToolBody;
  function?: { name?: string; arguments?: string | ToolBody };
};

function parseArgs(raw: string | ToolBody | undefined): ToolBody {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw) as ToolBody;
  } catch {
    return { utterances: raw };
  }
}

function toolCalls(message: ToolBody): VapiToolCall[] {
  const list =
    (message.toolCallList as VapiToolCall[] | undefined) ??
    (message.toolWithToolCallList as VapiToolCall[] | undefined) ??
    ((message.toolCalls as VapiToolCall[] | undefined) ?? []);
  return Array.isArray(list) ? list : [];
}

function toolName(call: VapiToolCall): string {
  return call.name ?? call.function?.name ?? "";
}

function toolArgs(call: VapiToolCall): ToolBody {
  return parseArgs(call.parameters ?? call.function?.arguments);
}

async function runTool(name: string, args: ToolBody, callId: string, to: string) {
  const payload = { ...args, call_id: String(args.call_id ?? callId), to: String(args.to ?? to) };
  if (name === "classify_lead" || name === "classify") return handleClassify(payload);
  if (name === "send_whatsapp" || name === "sendWhatsAppNow") return handleSendWhatsApp(payload);
  if (name === "book_callback" || name === "bookCallback") return handleBookCallback(payload);
  return { ok: false, error: `unknown tool ${name}` };
}

export async function handleVapiWebhook(body: ToolBody) {
  const message = (body.message as ToolBody | undefined) ?? body;
  const type = String(message.type ?? "");
  const call = (message.call as ToolBody | undefined) ?? {};
  const callId = String(call.id ?? body.call_id ?? store.latestCall()?.id ?? `vapi-${Date.now()}`);
  const customer = (call.customer as ToolBody | undefined) ?? {};
  const inbound = /inbound/i.test(String(call.type ?? message.type ?? ""));
  const from = String(customer.number ?? "");
  if (inbound && from) registerIncomingCall({ callId, from, provider: "vapi" });
  const to = String(store.getCall(callId)?.to ?? customer.number ?? store.latestCall()?.to ?? "");
  if (!to) return { ok: false, error: "no callee on this call" };

  if (type === "status-update") {
    const status = String(message.status ?? "");
    const reason = String(message.endedReason ?? call.endedReason ?? "");
    if (status === "in-progress") {
      store.upsertCall({
        id: callId,
        to,
        status: "in_progress",
        direction: inbound ? "inbound" : store.getCall(callId)?.direction ?? "outbound",
        provider: "vapi",
      });
    }
    if (status === "ended") {
      const voicemail = /voicemail/i.test(reason) || isVoicemailPayload(message) || isVoicemailPayload(body);
      store.upsertCall({ id: callId, to, status: "completed", voicemail: voicemail || undefined });
      if (voicemail) store.log("voicemail", `mailbox — hung up (${to})`, callId);
    }
    return { ok: true };
  }

  if (type === "tool-calls" || type === "function-call" || type === "tool.calls") {
    const calls = toolCalls(message);
    const single = message.functionCall as VapiToolCall | undefined;
    const all = calls.length ? calls : single ? [single] : [];
    const results = [];
    for (const item of all) {
      const name = toolName(item);
      const result = await runTool(name, toolArgs(item), callId, to);
      results.push({ toolCallId: item.id, result: JSON.stringify(result) });
    }
    return { results };
  }

  if (type === "end-of-call-report") {
    const artifact = (message.artifact as ToolBody | undefined) ?? {};
    const transcript = String(message.transcript ?? artifact.transcript ?? JSON.stringify(message.messages ?? ""));
    const analysis = (message.analysis as ToolBody | undefined) ?? {};
    const q = qualificationFromBody({
      utterances: transcript,
      quotes: String(analysis.summary ?? ""),
      classification: analysis.successEvaluation,
    });
    const existing = store.getCall(callId);
    const voicemail =
      existing?.voicemail ||
      isVoicemailPayload(message) ||
      isVoicemailPayload(body) ||
      /voicemail/i.test(String(message.endedReason ?? call.endedReason ?? "")) ||
      looksLikeVoicemailSpeech(transcript);
    store.upsertCall({
      id: callId,
      to,
      status: "completed",
      voicemail,
      classification: existing?.classification ?? q.classification,
      qualification: existing?.qualification ?? q,
      transcript,
      summary: String(analysis.summary ?? (voicemail ? "voicemail" : "")),
    });
    if (voicemail) {
      store.log("voicemail", `mailbox — hung up, no WhatsApp (${to})`, callId);
      await handleFollowUp({ callId, to, q: existing?.qualification ?? q, transcript, voicemail: true });
      return { ok: true, skipped: "voicemail" };
    }
    store.log("call_end", existing?.classification ?? q.classification, callId);
    await handleFollowUp({ callId, to, q: existing?.qualification ?? q, transcript });
    return { ok: true };
  }

  return { ok: true, ignored: type };
}
