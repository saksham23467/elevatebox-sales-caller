import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import OpenAI from "openai";
import { fileURLToPath } from "node:url";
import { config, paths, toE164 } from "./config.ts";
import { createBrowserSession, hangupOmnidimCall } from "./omnidim/client.ts";
import { scriptedReply } from "./rehearse/script.ts";
import { messagingStatus, needsBaileys } from "./adapters/messaging.ts";
import { csvFileBytes, listCallRows, syncCallsFromStore } from "./calls/sheet.ts";
import { placeOutboundCall } from "./adapters/telephony.ts";
import { canDial, isWithinCallingHours } from "./compliance/calling.ts";
import { ingestCampaignCsv, ingestInbound, ingestLeads } from "./leads/ingest.ts";
import { facebookFieldsToLead } from "./leads/inbound.ts";
import { startLeadQueueWorker } from "./leads/queue.ts";
import { pack } from "./packs/active.ts";
import { startCallbackWorker } from "./schedule/worker.ts";
import { store, type CampaignRecord, type LeadRecord } from "./store.ts";
import { startWhatsApp, whatsappStatus } from "./whatsapp/client.ts";
import { hangupVapiCall, probeVapi } from "./vapi/client.ts";
import { handleVapiWebhook } from "./vapi/webhook.ts";
import {
  handleBookCallback,
  handleClassify,
  handleFollowUp,
  handleSendWhatsApp,
  isVoicemailPayload,
  looksLikeVoicemailSpeech,
  qualificationFromBody,
  rememberCallParty,
  type ToolBody,
} from "./tools/handlers.ts";

const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req, body, done) => {
  done(null, body);
});

function authorize(headers: Record<string, unknown>, query: Record<string, unknown>) {
  const sent =
    String(
      headers["x-tool-secret"] ?? headers["x-vapi-secret"] ?? headers["authorization"] ?? query.secret ?? "",
    ).replace(/^Bearer\s+/i, "");
  return sent === config.toolSecret || sent === `Bearer ${config.toolSecret}`;
}

await app.register(cors, { origin: true });

function deskToken() {
  return createHash("sha256").update(`${config.dashboardPassword}:${config.toolSecret}`).digest("hex");
}

function deskSignedIn(cookieHeader: unknown) {
  if (!config.dashboardPassword) return true;
  const cookie = String(cookieHeader ?? "");
  return cookie.split(";").some((part) => part.trim() === `desk=${deskToken()}`);
}

const loginPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Calling desk</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #efe8dc; color: #1b1814; font: 15px/1.4 ui-sans-serif, Helvetica, Arial, sans-serif; }
    form { width: min(360px, calc(100% - 32px)); }
    h1 { font-family: Palatino, Georgia, serif; font-size: 28px; font-weight: 500; margin: 0 0 8px; }
    p { margin: 0 0 16px; color: #6f675c; }
    input { width: 100%; box-sizing: border-box; font: inherit; padding: 10px 12px; border: 1px solid #1b1814; background: #fff; }
    button { margin-top: 12px; font: inherit; padding: 8px 14px; background: #1d4736; color: #f4efe4; border: 0; cursor: pointer; }
    .err { min-height: 1.2em; margin-top: 10px; color: #7a2e24; }
  </style>
</head>
<body>
  <form id="f">
    <h1>${config.reProject}</h1>
    <p>${config.reBuilder}</p>
    <input name="password" type="password" placeholder="Password" autocomplete="current-password" autofocus />
    <button type="submit">Enter</button>
    <div class="err" id="err"></div>
  </form>
  <script>
    document.getElementById("f").onsubmit = async (e) => {
      e.preventDefault();
      const password = new FormData(e.target).get("password");
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) location.href = "/";
      else document.getElementById("err").textContent = "That password is not right.";
    };
  </script>
</body>
</html>`;

app.addHook("onRequest", async (req, reply) => {
  if (!config.dashboardPassword) return;
  const path = req.url.split("?")[0];
  if (path === "/health" || path === "/api/login" || path.startsWith("/tools/") || path.startsWith("/webhooks/")) return;
  if (deskSignedIn(req.headers.cookie)) return;
  if (path.startsWith("/api") || path.startsWith("/leads")) {
    return reply.code(401).send({ ok: false, error: "sign in" });
  }
  return reply.type("text/html").send(loginPage);
});

app.post("/api/login", async (req, reply) => {
  const password = String((req.body as { password?: string } | undefined)?.password ?? "");
  if (!config.dashboardPassword || password !== config.dashboardPassword) {
    return reply.code(401).send({ ok: false, error: "wrong password" });
  }
  reply.header(
    "set-cookie",
    `desk=${deskToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`,
  );
  return { ok: true };
});

await app.register(fastifyStatic, {
  root: fileURLToPath(paths.publicDir),
  prefix: "/",
});

app.get("/api/status", async () => {
  const vapi = await probeVapi();
  const latest = store.latestCall() ?? null;
  return {
    ok: true,
    lead: config.leadPhone,
    candidate: config.candidatePhone,
    candidateName: config.candidateName,
    publicUrl: config.publicUrl,
    omnidim: Boolean(config.omnidimKey && config.agentId),
    agentId: config.agentId || null,
    inboundNumber: config.omnidimPhoneNumber || vapi.numbers[0]?.number || null,
    vapi: {
      keyPresent: Boolean(config.vapiKey),
      authOk: vapi.ok,
      error: vapi.error ?? null,
      assistantId: config.vapiAssistantId || null,
      phoneNumberId: config.vapiPhoneNumberId || null,
      numbers: vapi.numbers,
    },
    vertical: config.vertical,
    market: config.market,
    callingHours: isWithinCallingHours(),
    messaging: messagingStatus(),
    whatsapp: messagingStatus().cloud
      ? { status: "ready", qr: null, error: null, channel: "whatsapp_cloud" }
      : { ...whatsappStatus(), channel: "whatsapp_baileys" },
    sheet: { csv: "/api/calls.csv", rows: listCallRows(40) },
    latest,
    slip: latest?.qualification ? pack().callSlip(latest.qualification) : null,
    packet: packetPreview(latest),
    recent: store.all().calls.slice(0, 8).map((c) => ({
      to: c.to,
      status: c.status,
      classification: c.classification,
      at: c.createdAt,
      wa: Boolean(c.whatsappMidSentAt || c.whatsappFollowupSentAt),
    })),
    events: store.all().events.slice(0, 25),
    project: {
      builder: config.reBuilder,
      name: config.reProject,
      city: config.reCity,
      agent: pack().agentName,
    },
    campaigns: store.all().campaigns.slice(0, 12).map(campaignView),
    leads: store.all().leads.slice(0, 400).map(leadView),
    inboxes: {
      link: `${config.publicUrl}/webhooks/leads?secret=${encodeURIComponent(config.toolSecret)}&source=`,
      facebook: `${config.publicUrl}/webhooks/facebook?secret=${encodeURIComponent(config.toolSecret)}`,
      facebookReady: Boolean(config.metaPageToken),
      verifyToken: config.toolSecret,
    },
  };
});

function leadView(lead: LeadRecord) {
  const call = lead.lastCallId ? store.getCall(lead.lastCallId) : undefined;
  return {
    id: lead.id,
    phone: lead.phone,
    name: lead.name ?? "",
    status: lead.status,
    source: lead.source,
    campaignId: lead.campaignId,
    waitMs: lead.waitMs,
    visitAt: lead.visitAt,
    walkedInAt: lead.walkedInAt,
    ingestedAt: lead.ingestedAt,
    skipReason: lead.skipReason,
    classification: call?.classification ?? null,
  };
}

function campaignView(campaign: CampaignRecord) {
  const stats = store.campaignStats(campaign.id);
  return {
    ...campaign,
    queued: stats.queued,
    dialing: stats.dialing,
    completed: stats.completed,
    failed: stats.failed,
    skipped: stats.skipped,
    unnamed: stats.unnamed,
  };
}

app.get("/health", async () => ({ ok: true }));

function webhookSecretOk(query: Record<string, unknown>) {
  return String(query.secret ?? "") === config.toolSecret;
}

app.post("/webhooks/leads", async (req, reply) => {
  const query = req.query as Record<string, unknown>;
  if (!webhookSecretOk(query)) return reply.code(401).send({ ok: false, error: "bad secret" });
  const source = typeof query.source === "string" ? query.source : undefined;
  const result = ingestInbound(req.body, source);
  if (!result.imported.length && !result.skipped) {
    return reply.code(400).send({ ok: false, error: "No mobile number in this lead" });
  }
  store.log("inbox", `${source || "inquiry"} +${result.imported.length} skipped ${result.skipped}`);
  return { ok: true, imported: result.imported.length, skipped: result.skipped };
});

app.get("/webhooks/facebook", async (req, reply) => {
  const query = req.query as Record<string, string>;
  if (!webhookSecretOk(query) && query["hub.verify_token"] !== config.toolSecret) {
    return reply.code(403).send("forbidden");
  }
  if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === config.toolSecret) {
    return reply.type("text/plain").send(String(query["hub.challenge"] ?? ""));
  }
  return reply.code(400).send("bad handshake");
});

app.post("/webhooks/facebook", async (req, reply) => {
  const query = req.query as Record<string, unknown>;
  if (!webhookSecretOk(query)) return reply.code(401).send({ ok: false });
  const body = (req.body ?? {}) as {
    entry?: Array<{ changes?: Array<{ field?: string; value?: { leadgen_id?: string } }> }>;
  };
  const ids: string[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field && change.field !== "leadgen") continue;
      const id = change.value?.leadgen_id;
      if (id) ids.push(String(id));
    }
  }
  if (!config.metaPageToken) {
    store.log("inbox", `facebook ${ids.length} lead(s) waiting on META_PAGE_ACCESS_TOKEN`);
    return { ok: true, imported: 0, waiting: "page token" };
  }
  let imported = 0;
  let skipped = 0;
  for (const id of ids) {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(id)}?fields=field_data,created_time&access_token=${encodeURIComponent(config.metaPageToken)}`,
    );
    const payload = (await res.json()) as { field_data?: unknown; error?: { message?: string } };
    if (!res.ok) {
      store.log("inbox", `facebook ${id} ${payload.error?.message || res.status}`);
      continue;
    }
    const lead = facebookFieldsToLead(payload.field_data);
    if (!lead) {
      skipped += 1;
      continue;
    }
    const saved = ingestInbound(lead, "facebook");
    imported += saved.imported.length;
    skipped += saved.skipped;
  }
  return { ok: true, imported, skipped };
});

function packetPreview(latest: ReturnType<typeof store.latestCall> | null) {
  const q = latest?.qualification;
  if (!latest || !q) return null;
  const vertical = pack();
  const mid = Boolean(latest.whatsappMidSentAt);
  return {
    kind: mid ? "mid" : latest.whatsappFollowupSentAt ? "followup" : "draft",
    sent: Boolean(latest.whatsappMidSentAt || latest.whatsappFollowupSentAt),
    architecture: Boolean(vertical.packetAttachments.architecture),
    text: mid
      ? vertical.midCallMessage(q)
      : vertical.followUpMessage(q, {
          callbackAt: latest.callbackAt ? new Date(latest.callbackAt) : undefined,
          visitAt: latest.visitAt ? new Date(latest.visitAt) : undefined,
          midCallAlready: mid,
        }),
  };
}

app.get("/api/calls.csv", async (_req, reply) => {
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", 'attachment; filename="calls.csv"')
    .send(csvFileBytes());
});

app.post("/api/rehearse-text", async (req, reply) => {
  const body = (req.body ?? {}) as { messages?: Array<{ role?: string; content?: string }> };
  const messages = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && String(m.content ?? "").trim())
    .slice(-12)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content).slice(0, 800),
    }));
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return reply.code(400).send({ ok: false, error: "Type a line first" });
  }
  const scripted = scriptedReply(messages[messages.length - 1].content);
  if (scripted) return { ok: true, text: scripted, source: "script" };
  const vertical = pack();
  try {
    const openai = new OpenAI({ apiKey: config.openaiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            vertical.systemPrompt() +
            "\n\nThis is a text rehearsal, not a live call. Do not call tools. Reply with only the words you would speak. One or two short sentences.",
        },
        ...messages,
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) return reply.code(502).send({ ok: false, error: "No reply" });
    return { ok: true, text };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return reply.code(502).send({ ok: false, error });
  }
});

app.post("/api/rehearse", async (_req, reply) => {
  try {
    const session = await createBrowserSession({
      lead_name: "",
      builder: config.reBuilder,
      project_name: config.reProject,
      city: config.reCity,
    });
    return { ok: true, wsUrl: session.wsUrl, expiresAt: session.expiresAt };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return reply.code(502).send({ ok: false, error });
  }
});

app.post("/api/call", async (req, reply) => {
  const body = (req.body ?? {}) as { to?: string; test?: boolean };
  const to = toE164(body.to || (body.test ? config.candidatePhone : config.leadPhone));
  const gate = canDial({ phone: to, playbook: "speed", consentSource: "manual_dial" });
  if (!gate.ok) {
    store.log("dial_skip", `${to} ${gate.reason}`);
    return reply.code(403).send({ ok: false, error: gate.reason });
  }
  const id = `out-${Date.now()}`;
  store.upsertCall({ id, to, status: "dialing", direction: "outbound" });
  try {
    const placed = await placeOutboundCall(to, {
      candidate_name: config.candidateName,
      candidate_phone: config.candidatePhone,
      our_call_id: id,
    });
    const call = placed.call as { id?: string; requestId?: string | number };
    const remoteId = String(call.id ?? call.requestId ?? id);
    store.upsertCall({ id: remoteId, to, status: "dialing", provider: placed.provider, remoteId, direction: "outbound" });
    store.log("dial", `${placed.provider} calling ${to}`, remoteId);
    return { ok: true, to, provider: placed.provider, call: placed.call };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    store.upsertCall({ id, status: "failed" });
    store.log("dial_fail", error, id);
    return reply.code(502).send({ ok: false, error });
  }
});

async function hangupLiveCall() {
  const latest = store.latestCall();
  const cutoff = Date.now() - 12 * 60 * 1000;
  if (
    !latest ||
    (latest.status !== "dialing" && latest.status !== "in_progress") ||
    new Date(latest.createdAt).getTime() < cutoff
  ) {
    return { ok: false as const, error: "no live call" };
  }
  const remoteId = latest.remoteId || latest.id;
  try {
    const result =
      latest.provider === "vapi" ? await hangupVapiCall(remoteId) : await hangupOmnidimCall(remoteId);
    store.upsertCall({ id: latest.id, status: "completed" });
    store.log("hangup", `ended ${latest.to}`, latest.id);
    const rec = store.getCall(latest.id);
    if (!rec?.voicemail) {
      await handleFollowUp({
        callId: latest.id,
        to: latest.to,
        q: rec?.qualification ?? {
          classification: rec?.classification ?? "warm",
          confidence: 0.5,
          reasons: ["ended from desk"],
          quotes: [],
        },
      });
    }
    return { ok: true as const, to: latest.to, result };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    store.log("hangup_fail", error, latest.id);
    return { ok: false as const, error };
  }
}

app.post("/api/hangup", async (_req, reply) => {
  const result = await hangupLiveCall();
  if (!result.ok) return reply.code(result.error === "no live call" ? 409 : 502).send(result);
  return result;
});

function toolGuard(req: { headers: Record<string, unknown>; query: Record<string, unknown> }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (!authorize(req.headers, req.query)) {
    return reply.code(401).send({ ok: false, error: "bad secret" });
  }
  return null;
}

app.post("/tools/classify", async (req, reply) => {
  if (toolGuard(req as never, reply as never)) return;
  return handleClassify((req.body ?? {}) as ToolBody);
});

app.post("/tools/send-whatsapp", async (req, reply) => {
  if (toolGuard(req as never, reply as never)) return;
  return handleSendWhatsApp((req.body ?? {}) as ToolBody);
});

app.post("/tools/book-callback", async (req, reply) => {
  if (toolGuard(req as never, reply as never)) return;
  return handleBookCallback((req.body ?? {}) as ToolBody);
});

app.post("/tools/hangup", async (req, reply) => {
  if (toolGuard(req as never, reply as never)) return;
  const result = await hangupLiveCall();
  return { ok: true, hung_up: result.ok, error: result.ok ? undefined : ("error" in result ? result.error : undefined) };
});

app.post("/webhooks/vapi", async (req, reply) => {
  if (toolGuard(req as never, reply as never)) return;
  return handleVapiWebhook((req.body ?? {}) as ToolBody);
});

app.post("/webhooks/omnidim", async (req) => {
  const body = (req.body ?? {}) as ToolBody;
  const callId = String(body.call_id ?? body.id ?? body.callId ?? store.latestCall()?.id ?? `end-${Date.now()}`);
  const to = rememberCallParty(body, callId);
  const vars = (body.call_report as ToolBody | undefined)?.extracted_variables ?? body.extracted_variables ?? body;
  const transcript = JSON.stringify(body.fullConversation ?? body.transcript ?? "");
  const voicemail = isVoicemailPayload(body) || looksLikeVoicemailSpeech(transcript);
  const q = qualificationFromBody({ ...(vars as ToolBody), utterances: transcript });
  if (voicemail) {
    await hangupLiveCall();
  }
  store.upsertCall({
    id: callId,
    to,
    status: "completed",
    voicemail,
    classification: q.classification,
    qualification: q,
    transcript,
    summary: String((body.call_report as ToolBody | undefined)?.summary ?? body.summary ?? (voicemail ? "voicemail" : "")),
  });
  const leadId = store.getCall(callId)?.leadId;
  if (leadId) store.upsertLead({ id: leadId, status: voicemail ? "completed" : "completed" });
  if (voicemail) {
    store.log("voicemail", `mailbox — hung up, no WhatsApp (${to})`, callId);
    await handleFollowUp({ callId, to, q, transcript, voicemail: true });
    return { ok: true, skipped: "voicemail" };
  }
  store.log("call_end", q.classification, callId);
  const spoken = String((vars as ToolBody).callback_spoken ?? "");
  if (spoken && !store.getCall(callId)?.callbackAt) {
    await handleBookCallback({ call_id: callId, spoken_time: spoken, to });
  }
  await handleFollowUp({ callId, to, q, transcript });
  return { ok: true };
});

app.post("/leads", async (req, reply) => {
  if (toolGuard(req as never, reply as never)) return;
  try {
    const leads = ingestLeads((req.body ?? {}) as Parameters<typeof ingestLeads>[0]);
    return { ok: true, leads };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/leads", async (req, reply) => {
  if (toolGuard(req as never, reply as never)) return;
  try {
    const leads = ingestLeads((req.body ?? {}) as Parameters<typeof ingestLeads>[0]);
    return { ok: true, leads };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function csvFromRequest(req: { body?: unknown; headers: Record<string, unknown> }): { csv: string; filename?: string; start?: boolean } {
  const body = req.body;
  if (typeof body === "string") {
    return { csv: body, filename: String(req.headers["x-filename"] ?? "leads.csv") };
  }
  const json = (body ?? {}) as { csv?: string; filename?: string; start?: boolean };
  return { csv: String(json.csv ?? ""), filename: json.filename, start: Boolean(json.start) };
}

app.post("/api/campaigns", async (req, reply) => {
  try {
    const { csv, filename, start } = csvFromRequest(req as never);
    if (!csv.trim()) return reply.code(400).send({ ok: false, error: "CSV is empty" });
    const result = ingestCampaignCsv({ csv, filename, start });
    return {
      ok: true,
      campaign: campaignView(result.campaign),
      imported: result.leads.length,
      unnamed: result.unnamed,
      rejected: result.rejected.slice(0, 40),
      rejectedCount: result.rejected.length,
      skippedBusy: result.skippedBusy,
    };
  } catch (err) {
    return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/campaigns", async () => ({
  ok: true,
  campaigns: store.all().campaigns.map(campaignView),
}));

app.post("/api/campaigns/:id/start", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  try {
    const campaign = store.startCampaign(id);
    store.log("campaign_start", campaign.filename, campaign.id);
    return { ok: true, campaign: campaignView(campaign) };
  } catch (err) {
    return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/leads/:id/came", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  const lead = store.getLead(id);
  if (!lead) return reply.code(404).send({ ok: false, error: "Lead not found" });
  if (!lead.visitAt) return reply.code(409).send({ ok: false, error: "No visit booked yet" });
  const updated = store.upsertLead({ id, walkedInAt: lead.walkedInAt ?? new Date().toISOString() });
  return { ok: true, walkedInAt: updated.walkedInAt };
});

app.post("/api/campaigns/:id/pause", async (req, reply) => {
  const id = (req.params as { id: string }).id;
  try {
    const campaign = store.pauseCampaign(id);
    store.log("campaign_pause", campaign.filename, campaign.id);
    return { ok: true, campaign: campaignView(campaign) };
  } catch (err) {
    return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/simulate-whatsapp", async (req) => {
  const body = (req.body ?? {}) as ToolBody;
  const vertical = pack();
  const q = vertical.classifyLead({
    utterances: String(body.utterances ?? "send me the details, budget around 2 lakhs, 200 sarees, need it before Diwali"),
    budget: String(body.budget ?? "2 lakhs"),
    products: String(body.products ?? "sarees"),
    timeline: String(body.timeline ?? "before Diwali"),
    askedForDetails: true,
  });
  const to = String(body.to ?? config.candidatePhone);
  return handleSendWhatsApp({
    classification: q.classification,
    quotes: q.quotes.join("|"),
    products: q.products,
    budget: q.budget,
    timeline: q.timeline,
    to,
    force: true,
    call_id: `sim-${Date.now()}`,
  });
});

app.get("/api/leads", async () => ({ ok: true, leads: store.all().leads.slice(0, 50) }));

app.post("/api/opt-out", async (req, reply) => {
  const body = (req.body ?? {}) as { phone?: string };
  if (!body.phone) return reply.code(400).send({ ok: false, error: "phone required" });
  store.addDnd(body.phone);
  store.log("opt_out", toE164(body.phone));
  return { ok: true, dnd: true };
});

app.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith("/api") || req.raw.url?.startsWith("/tools") || req.raw.url?.startsWith("/webhooks") || req.raw.url?.startsWith("/leads")) {
    return reply.code(404).send({ ok: false });
  }
  return reply.sendFile("index.html");
});

syncCallsFromStore(store.all().calls);
if (needsBaileys()) await startWhatsApp();
startCallbackWorker();
startLeadQueueWorker();

await app.listen({ port: config.port, host: "0.0.0.0" });
console.log(`Dashboard http://localhost:${config.port}`);
