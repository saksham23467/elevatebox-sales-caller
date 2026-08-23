import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { config, paths, toE164 } from "./config.ts";
import { classifyLead } from "./qualify/classify.ts";
import { startCallbackWorker } from "./schedule/worker.ts";
import { store } from "./store.ts";
import { probeVapi } from "./vapi/client.ts";
import { placeOutboundCall } from "./vapi/placeCall.ts";
import { handleVapiWebhook } from "./vapi/webhook.ts";
import {
  handleBookCallback,
  handleClassify,
  handleFollowUp,
  handleSendWhatsApp,
  qualificationFromBody,
  resolveCallee,
  type ToolBody,
} from "./tools/handlers.ts";
import { startWhatsApp, whatsappStatus } from "./whatsapp/client.ts";
import { callSlip } from "./whatsapp/copy.ts";

const app = Fastify({ logger: true });

function authorize(headers: Record<string, unknown>, query: Record<string, unknown>) {
  const sent =
    String(
      headers["x-tool-secret"] ?? headers["x-vapi-secret"] ?? headers["authorization"] ?? query.secret ?? "",
    ).replace(/^Bearer\s+/i, "");
  return sent === config.toolSecret || sent === `Bearer ${config.toolSecret}`;
}

await app.register(cors, { origin: true });
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
    publicUrl: config.publicUrl,
    omnidim: Boolean(config.omnidimKey && config.agentId),
    agentId: config.agentId || null,
    vapi: {
      keyPresent: Boolean(config.vapiKey),
      authOk: vapi.ok,
      error: vapi.error ?? null,
      assistantId: config.vapiAssistantId || null,
      phoneNumberId: config.vapiPhoneNumberId || null,
      numbers: vapi.numbers,
    },
    whatsapp: whatsappStatus(),
    latest,
    slip: latest?.qualification ? callSlip(latest.qualification) : null,
    events: store.all().events.slice(0, 25),
  };
});

app.post("/api/call", async (req, reply) => {
  const body = (req.body ?? {}) as { to?: string; test?: boolean };
  const to = toE164(body.to || (body.test ? config.candidatePhone : config.leadPhone));
  const id = `out-${Date.now()}`;
  store.upsertCall({ id, to, status: "dialing" });
  try {
    const placed = await placeOutboundCall(to, {
      candidate_name: config.candidateName,
      candidate_phone: config.candidatePhone,
      our_call_id: id,
    });
    const call = placed.call as { id?: string; requestId?: string | number };
    const remoteId = String(call.id ?? call.requestId ?? id);
    store.upsertCall({ id: remoteId, to, status: "dialing" });
    store.log("dial", `${placed.provider} calling ${to}`, remoteId);
    return { ok: true, to, provider: placed.provider, call: placed.call };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    store.upsertCall({ id, status: "failed" });
    store.log("dial_fail", error, id);
    return reply.code(502).send({ ok: false, error });
  }
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

app.post("/webhooks/vapi", async (req, reply) => {
  if (toolGuard(req as never, reply as never)) return;
  return handleVapiWebhook((req.body ?? {}) as ToolBody);
});

app.post("/webhooks/omnidim", async (req) => {
  const body = (req.body ?? {}) as ToolBody;
  const callId = String(body.call_id ?? body.id ?? body.callId ?? store.latestCall()?.id ?? `end-${Date.now()}`);
  const to = resolveCallee(body, callId);
  const vars = (body.call_report as ToolBody | undefined)?.extracted_variables ?? body.extracted_variables ?? body;
  const transcript = JSON.stringify(body.fullConversation ?? body.transcript ?? "");
  const q = qualificationFromBody({ ...(vars as ToolBody), utterances: transcript });
  store.upsertCall({
    id: callId,
    to,
    status: "completed",
    classification: q.classification,
    qualification: q,
    transcript,
    summary: String((body.call_report as ToolBody | undefined)?.summary ?? body.summary ?? ""),
  });
  store.log("call_end", q.classification, callId);
  const spoken = String((vars as ToolBody).callback_spoken ?? "");
  if (spoken && !store.getCall(callId)?.callbackAt) {
    await handleBookCallback({ call_id: callId, spoken_time: spoken, to });
  }
  await handleFollowUp({ callId, to, q, transcript });
  return { ok: true };
});

app.post("/api/simulate-whatsapp", async (req) => {
  const body = (req.body ?? {}) as ToolBody;
  const q = classifyLead({
    utterances: String(body.utterances ?? "send me the details, budget around 2 lakhs, 200 sarees, need it before Diwali"),
    budget: String(body.budget ?? "2 lakhs"),
    products: String(body.products ?? "sarees"),
    timeline: String(body.timeline ?? "before Diwali"),
    askedForDetails: true,
  });
  const to = String(body.to ?? config.candidatePhone);
  return handleSendWhatsApp({
    ...q,
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

app.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith("/api") || req.raw.url?.startsWith("/tools") || req.raw.url?.startsWith("/webhooks")) {
    return reply.code(404).send({ ok: false });
  }
  return reply.sendFile("index.html");
});

await startWhatsApp();
startCallbackWorker();

await app.listen({ port: config.port, host: "0.0.0.0" });
console.log(`Dashboard http://localhost:${config.port}`);
