import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CustomApiIntegrationInput, IntegrationParam } from "@omnidim-ai/sdk";
import { config } from "../config.ts";
import { omnidim } from "./client.ts";
import { pack } from "../packs/active.ts";
import { indiaVoice } from "./voice.ts";

const QUAL: IntegrationParam[] = pack().toolQual.map((p) => ({
  key: p.key,
  description: p.description,
  type: p.type,
  required: p.required,
}));

function toolUrl(path: string) {
  return `${config.publicUrl}${path}`;
}

function envPath() {
  return fileURLToPath(new URL("../../.env", import.meta.url));
}

function writeEnv(key: string, value: string) {
  const path = envPath();
  let env = readFileSync(path, "utf8");
  if (new RegExp(`^${key}=`, "m").test(env)) env = env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  else env += `\n${key}=${value}\n`;
  writeFileSync(path, env);
}

function writeAgentId(id: string) {
  writeEnv("OMNIDIM_AGENT_ID", id);
}

async function pickVoice(_client: ReturnType<typeof omnidim>) {
  return { ...indiaVoice.voice };
}

function integrationId(res: Record<string, unknown>): number | undefined {
  const nested = res.integration as Record<string, unknown> | undefined;
  const id = res.id ?? res.integration_id ?? nested?.id;
  return id != null ? Number(id) : undefined;
}

const OMNIDIM_API = "https://backend.omnidim.io/api/v1";

async function omnidimFetch(method: string, path: string, body?: unknown) {
  const res = await fetch(`${OMNIDIM_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.omnidimKey}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const detail = typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed ?? res.status);
    throw new Error(`${method} ${path} ${res.status}: ${detail}`);
  }
  return parsed;
}

const END_CALL = {
  enabled: true,
  condition:
    "The lead says goodbye, hang up, or cut the call; nobody has spoken for about ten seconds of dead air; the pickup is voicemail, an answering machine, a beep, 'leave a message after the tone', or a recorded greeting with no live person; or qualification plus the next action are done.",
  message_type: "prompt" as const,
  message_prompt:
    "If this is voicemail, a machine, or dead air, say nothing. Otherwise end politely in the same language in one short sentence.",
};

const VOICEMAIL = {
  enabled: true,
  message: "",
};

function webhookConfig() {
  return {
    enabled: true,
    url: toolUrl("/webhooks/omnidim"),
    include: ["summary", "extracted_variables", "fullConversation", "sentiment"],
    extracted_variables: pack().extractedVariables,
    trigger_call_statuses: ["completed", "failed", "no_answer", "busy", "cancelled", "voicemail_detected"],
  };
}

function toolSpecs(): Array<CustomApiIntegrationInput & { stop?: boolean }> {
  return [
    {
      name: "Classify The Call",
      description: "Call as soon as you can tell hot, warm, or cold. Pass their actual words in quotes. Does not send WhatsApp.",
      url: toolUrl("/tools/classify"),
      method: "POST",
      headers: [
        { key: "X-Tool-Secret", value: config.toolSecret },
        { key: "Content-Type", value: "application/json" },
      ],
      body_params: QUAL,
      request_timeout: 4,
    },
    {
      name: "Send WhatsApp Now",
      description: "Call when the lead is HOT or asked for details. Sends WhatsApp (text + contact, no resume) then keep talking.",
      url: toolUrl("/tools/send-whatsapp"),
      method: "POST",
      headers: [
        { key: "X-Tool-Secret", value: config.toolSecret },
        { key: "Content-Type", value: "application/json" },
      ],
      body_params: QUAL,
      stop_listening: false,
      request_timeout: 6,
    },
    {
      name: "Schedule Callback",
      description: "Call when the lead names a time to call back, including tomorrow morning or kal subah. Pass spoken_time as their exact words.",
      url: toolUrl("/tools/book-callback"),
      method: "POST",
      headers: [
        { key: "X-Tool-Secret", value: config.toolSecret },
        { key: "Content-Type", value: "application/json" },
      ],
      body_params: [...QUAL, { key: "spoken_time", description: "Exact words they used for the callback time", type: "string", required: true }],
      request_timeout: 8,
    },
    {
      name: "End The Call",
      description:
        "Cut the phone call immediately. Use on goodbye, hang up, cut the call, bas, about ten seconds of dead air with nobody speaking, voicemail, an answering machine, a beep, or 'leave a message after the tone'. On a machine or silence say nothing first.",
      url: toolUrl("/tools/hangup"),
      method: "POST",
      headers: [
        { key: "X-Tool-Secret", value: config.toolSecret },
        { key: "Content-Type", value: "application/json" },
      ],
      body_params: [{ key: "call_id", description: "OmniDimension call id if you have it", type: "string" }],
      stop_listening: true,
      request_timeout: 8,
    },
  ];
}

async function retargetIntegration(id: number, spec: CustomApiIntegrationInput) {
  const payload = { integration_type: "custom_api", ...spec };
  const attempts: Array<[string, string]> = [
    ["PUT", `/integrations/${id}`],
    ["PATCH", `/integrations/${id}`],
    ["PUT", `/integrations/custom-api/${id}`],
    ["PATCH", `/integrations/custom-api/${id}`],
  ];
  for (const [method, path] of attempts) {
    try {
      const updated = await omnidimFetch(method, path, payload);
      console.log("retargeted", spec.name, spec.url, method, path);
      return updated;
    } catch (err) {
      console.warn(err instanceof Error ? err.message : err);
    }
  }
  return null;
}

async function ensureAttached(client: ReturnType<typeof omnidim>, agentId: number, integrationIdNum: number, name: string) {
  try {
    const added = await client.integrations.addToAgent(agentId, integrationIdNum);
    console.log("attached", name, added);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already|exists|attached/i.test(msg)) console.log("already on agent", name, integrationIdNum);
    else console.warn("could not attach", name, msg);
  }
}

async function attachTools(client: ReturnType<typeof omnidim>, agentId: number) {
  const listed = await client.integrations.list().catch(() => ({ integrations: [] as Array<{ id?: number; name?: string; url?: string }> }));
  const all = listed.integrations ?? [];
  const attached = await client.integrations.listForAgent(agentId).catch(() => ({ integrations: [] as Array<{ id?: number; name?: string; url?: string }> }));
  const current = attached.integrations ?? [];
  const keepIds = new Set<number>();

  for (const spec of toolSpecs()) {
    const named = [...all, ...current].filter((i) => i.name === spec.name);
    const existing =
      named.find((i) => i.url?.startsWith(config.publicUrl)) ?? named[0];
    if (existing?.id) {
      const updated = await retargetIntegration(existing.id, spec);
      if (updated) {
        keepIds.add(existing.id);
        await ensureAttached(client, agentId, existing.id, spec.name);
        continue;
      }
      if (existing.url?.startsWith(config.publicUrl)) {
        keepIds.add(existing.id);
        console.log("keep (retarget skipped)", spec.name, spec.url);
        await ensureAttached(client, agentId, existing.id, spec.name);
        continue;
      }
    }
    try {
      const created = await client.integrations.createCustomApi(spec);
      if (created && typeof created === "object" && "success" in created && created.success === false) {
        throw new Error(String((created as { error?: string }).error ?? "create failed"));
      }
      const id = integrationId(created as Record<string, unknown>);
      console.log(spec.name, spec.url, created);
      if (id) {
        keepIds.add(id);
        await ensureAttached(client, agentId, id, spec.name);
      }
    } catch (err) {
      console.warn(`Add "${spec.name}" in the OmniDimension dashboard if this failed:`, err instanceof Error ? err.message : err);
      console.warn(JSON.stringify(spec, null, 2));
    }
  }

  for (const item of current) {
    if (!item.id) continue;
    if (!/classify|whatsapp|callback|hang|schedule|end the call/i.test(item.name ?? "")) continue;
    if (keepIds.has(item.id)) continue;
    const replaced = [...keepIds].length > 0 && keepIds.size >= toolSpecs().length;
    if (!replaced) {
      console.warn("leaving", item.name, item.id, "— replacement was not created");
      continue;
    }
    try {
      await client.integrations.removeFromAgent(agentId, item.id);
      console.log("detached stale", item.name, item.id);
    } catch (err) {
      console.warn("could not detach", item.name, err instanceof Error ? err.message : err);
    }
  }
}

/** Point an account DID at this agent so inbound PSTN is answered by the same Ananya. */
async function ensureInboundNumber(client: ReturnType<typeof omnidim>, agentId: number) {
  const listed = await client.phoneNumbers.list({ pagesize: 50 }).catch((err) => {
    console.warn("could not list OmniDim numbers", err instanceof Error ? err.message : err);
    return { phone_numbers: [] as Array<{ id?: number; phone_number?: string; active_bot_id?: number | boolean }> };
  });
  const numbers = listed.phone_numbers ?? [];
  if (!numbers.length) {
    console.warn(
      "No OmniDim phone numbers on this account. Buy or import one, then re-run setup so people who dial it reach Ananya.",
    );
    return;
  }
  const preferredId = config.omnidimPhoneId ? Number(config.omnidimPhoneId) : NaN;
  const chosen =
    numbers.find((n) => n.id === preferredId) ??
    numbers.find((n) => n.active_bot_id === agentId) ??
    numbers.find((n) => !n.active_bot_id) ??
    numbers[0];
  if (!chosen?.id) return;
  if (chosen.active_bot_id === agentId) {
    console.log("inbound already on agent", chosen.phone_number ?? chosen.id);
  } else {
    try {
      const attached = await client.phoneNumbers.attach({ phone_number_id: chosen.id, agent_id: agentId });
      console.log("inbound number attached", chosen.phone_number ?? chosen.id, attached);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already|attach/i.test(msg)) console.log("inbound already attached", chosen.phone_number ?? chosen.id);
      else console.warn("could not attach inbound number", msg);
    }
  }
  writeEnv("OMNIDIM_PHONE_NUMBER_ID", String(chosen.id));
  if (chosen.phone_number) writeEnv("OMNIDIM_PHONE_NUMBER", chosen.phone_number);
}

async function main() {
  if (!config.omnidimKey) throw new Error("Set OMNIDIM_API_KEY in .env first");
  if (config.publicUrl.includes("localhost")) {
    console.warn("PUBLIC_URL is localhost. Tunnel first, then re-run setup so tools are reachable mid-call.");
  }

  const client = omnidim();
  const voice = await pickVoice(client);

  if (process.argv.includes("--update") && config.agentId) {
    const vertical = pack();
    const payload = {
      name: vertical.agentTitle,
      welcome_message: vertical.welcomeMessage,
      is_welcome_message_dynamic: false,
      is_welcome_message_interruption: true,
      is_interruption_allowed: true,
      context_breakdown: vertical.contextBreakdown(),
      model: { model: "gpt-4o-mini", temperature: 0.4 },
      voice: indiaVoice.voice,
      transcriber: indiaVoice.transcriber,
      background_track: indiaVoice.background_track,
      languages: ["English (India)", "Hindi", "Telugu"],
      user_idle_threshold_sec: 10,
      first_ideal_message: "",
      second_ideal_message: "",
      last_ideal_message: "Bye.",
      end_call: END_CALL,
      voicemail: VOICEMAIL,
      post_call_actions: { webhook: webhookConfig() },
    };
    const { voicemail: _vm, ...withoutVm } = payload;
    const attempts = [
      payload,
      { ...payload, transcriber: { ...indiaVoice.transcriber, language: "hi-IN" } },
      withoutVm,
      { ...withoutVm, transcriber: { ...indiaVoice.transcriber, language: "hi-IN" } },
    ];
    let lastErr: unknown;
    for (const attempt of attempts) {
      try {
        const updated = await client.agents.update(Number(config.agentId), attempt as never);
        const usedVm = "voicemail" in attempt;
        console.log("Updated agent", config.agentId, usedVm ? "voicemail AMD on" : "voicemail AMD skipped", updated, indiaVoice.voice);
        if (!usedVm) {
          console.warn(
            "OmniDim voicemail detection is not on this account. Ananya will still hang up via Hang The Line + end_call when she hears a machine. Request AMD at https://omnidim.io/contact-us?reason=product&lock=1",
          );
        }
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        console.warn("agent update retry:", err instanceof Error ? err.message : err);
      }
    }
    if (lastErr) throw lastErr;
    await attachTools(client, Number(config.agentId));
    await ensureInboundNumber(client, Number(config.agentId));
    return;
  }

  const vertical = pack();
  const agent = await client.agents.create({
    // SDK types currently intersect with Record<string, never>
    name: vertical.agentTitle,
    welcome_message: vertical.welcomeMessage,
    is_welcome_message_dynamic: false,
    is_welcome_message_interruption: true,
    is_interruption_allowed: true,
    call_type: "Outgoing",
    context_breakdown: vertical.contextBreakdown(),
    transcriber: indiaVoice.transcriber,
    model: { model: "gpt-4o-mini", temperature: 0.4 },
    voice,
    background_track: indiaVoice.background_track,
    languages: ["English (India)", "Hindi", "Telugu"],
    user_idle_threshold_sec: 10,
    first_ideal_message: "",
    second_ideal_message: "",
    last_ideal_message: "Bye.",
    end_call: END_CALL,
    voicemail: VOICEMAIL,
    post_call_actions: { webhook: webhookConfig() },
  } as never);

  const agentId = Number(agent.id);
  if (!agentId) throw new Error(`Agent create returned no id: ${JSON.stringify(agent)}`);
  console.log("Created agent", agentId, voice);
  writeAgentId(String(agentId));
  await attachTools(client, agentId);
  await ensureInboundNumber(client, agentId);

  const logFile = fileURLToPath(new URL("../../data/setup-log.txt", import.meta.url));
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${new Date().toISOString()} agent=${agentId} public=${config.publicUrl}\n`);
  console.log("Done. OMNIDIM_AGENT_ID written to .env");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
