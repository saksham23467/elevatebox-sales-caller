import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CustomApiIntegrationInput, IntegrationParam } from "@omnidim-ai/sdk";
import { config } from "../config.ts";
import { omnidim } from "./client.ts";
import { contextBreakdown, welcomeMessage } from "./prompt.ts";

const QUAL: IntegrationParam[] = [
  { key: "classification", description: "hot, warm, or cold based on buying intent, not politeness", type: "string", required: true },
  { key: "quotes", description: "verbatim phrases the lead said, separated by |", type: "string", required: true },
  { key: "budget", description: "budget they mentioned, or empty", type: "string" },
  { key: "products", description: "what they sell", type: "string" },
  { key: "catalog_size", description: "how many products if mentioned", type: "string" },
  { key: "timeline", description: "when they need the site live", type: "string" },
  { key: "features", description: "features they asked for", type: "string" },
  { key: "barrier", description: "why they cannot buy now, if any", type: "string" },
  { key: "language", description: "en, hi, or te", type: "string" },
  { key: "call_id", description: "OmniDimension call id if you have it", type: "string" },
];

function toolUrl(path: string) {
  return `${config.publicUrl}${path}`;
}

function envPath() {
  return fileURLToPath(new URL("../../.env", import.meta.url));
}

function writeAgentId(id: string) {
  const path = envPath();
  let env = readFileSync(path, "utf8");
  if (/^OMNIDIM_AGENT_ID=/m.test(env)) env = env.replace(/^OMNIDIM_AGENT_ID=.*$/m, `OMNIDIM_AGENT_ID=${id}`);
  else env += `\nOMNIDIM_AGENT_ID=${id}\n`;
  writeFileSync(path, env);
}

async function pickVoice(client: ReturnType<typeof omnidim>) {
  try {
    const { voices } = await client.providers.listVoices({
      provider: "eleven_labs",
      gender: "female",
      language: "hi",
      page_size: 20,
    });
    const first = voices?.[0];
    if (first?.name) return { provider: "eleven_labs" as const, voice_id: first.name, speech_speed: 1 };
  } catch {
    /* default */
  }
  return { provider: "eleven_labs" as const, voice_id: "EXAVITQu4vr4xnSDxMaL", speech_speed: 1 };
}

function integrationId(res: Record<string, unknown>): number | undefined {
  const nested = res.integration as Record<string, unknown> | undefined;
  const id = res.id ?? res.integration_id ?? nested?.id;
  return id != null ? Number(id) : undefined;
}

async function main() {
  if (!config.omnidimKey) throw new Error("Set OMNIDIM_API_KEY in .env first");
  if (config.publicUrl.includes("localhost")) {
    console.warn("PUBLIC_URL is localhost. Tunnel first, then re-run setup so tools are reachable mid-call.");
  }

  const client = omnidim();
  const voice = await pickVoice(client);

  if (process.argv.includes("--update") && config.agentId) {
    const updated = await client.agents.update(Number(config.agentId), {
      name: "Saksham Ecom Sales — Ananya",
      welcome_message: welcomeMessage,
      is_welcome_message_dynamic: false,
      is_welcome_message_interruption: true,
      is_interruption_allowed: true,
      context_breakdown: contextBreakdown(),
      model: { model: "gpt-4.1-mini", temperature: 0.5 },
    } as never);
    console.log("Updated agent", config.agentId, updated);
    return;
  }

  const agent = await client.agents.create({
    // SDK types currently intersect with Record<string, never>
    name: "Saksham Ecom Sales — Ananya",
    welcome_message: welcomeMessage,
    is_welcome_message_dynamic: false,
    is_welcome_message_interruption: true,
    is_interruption_allowed: true,
    call_type: "Outgoing",
    context_breakdown: contextBreakdown(),
    transcriber: {
      provider: "soniox",
      language: "en-IN",
      silence_timeout_ms: 400,
      interruption_min_words: 2,
      max_call_duration_in_sec: 420,
      should_apply_noise_reduction: true,
    },
    model: { model: "gpt-4.1-mini", temperature: 0.35 },
    voice,
    background_track: { enabled: true, name: "office", volume: 0.15 },
    languages: ["English (India)", "Hindi", "Telugu"],
    end_call: {
      enabled: true,
      condition: "The lead says goodbye, is not interested, or qualification plus the next action are done.",
      message_type: "prompt",
      message_prompt: "End politely in the same language the lead is speaking. One short sentence.",
    },
    post_call_actions: {
      webhook: {
        enabled: true,
        url: toolUrl("/webhooks/omnidim"),
        include: ["summary", "extracted_variables", "fullConversation", "sentiment"],
        extracted_variables: [
          { key: "classification", prompt: "hot, warm, or cold" },
          { key: "budget", prompt: "Budget mentioned" },
          { key: "products", prompt: "What they sell" },
          { key: "catalog_size", prompt: "Number of products" },
          { key: "timeline", prompt: "When they need the site" },
          { key: "features", prompt: "Features requested" },
          { key: "barrier", prompt: "Why they cannot buy now" },
          { key: "quotes", prompt: "Verbatim quotes, separated by |" },
          { key: "language", prompt: "en, hi, or te" },
          { key: "callback_spoken", prompt: "Any callback time they named, verbatim" },
        ],
        trigger_call_statuses: ["completed", "failed", "no_answer", "busy", "cancelled"],
      },
    },
  } as never);

  const agentId = Number(agent.id);
  if (!agentId) throw new Error(`Agent create returned no id: ${JSON.stringify(agent)}`);
  console.log("Created agent", agentId, voice);
  writeAgentId(String(agentId));

  const specs: Array<CustomApiIntegrationInput & { stop?: boolean }> = [
    {
      name: "Classify Lead",
      description: "Call as soon as you can tell hot, warm, or cold. Pass their actual words in quotes. Does not send WhatsApp.",
      url: toolUrl("/tools/classify"),
      method: "POST",
      headers: [
        { key: "X-Tool-Secret", value: config.toolSecret },
        { key: "Content-Type", value: "application/json" },
      ],
      body_params: QUAL,
      request_timeout: 8,
    },
    {
      name: "Send WhatsApp Now",
      description: "Fire DURING the call when intent is HOT or they asked for details. Do not wait until hangup. Then confirm out loud that WhatsApp is going out.",
      url: toolUrl("/tools/send-whatsapp"),
      method: "POST",
      headers: [
        { key: "X-Tool-Secret", value: config.toolSecret },
        { key: "Content-Type", value: "application/json" },
      ],
      body_params: QUAL,
      stop_listening: true,
      request_timeout: 12,
    },
    {
      name: "Book Callback",
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
  ];

  for (const spec of specs) {
    try {
      const created = await client.integrations.createCustomApi(spec);
      const id = integrationId(created);
      console.log(spec.name, created);
      if (id) {
        const attached = await client.integrations.addToAgent(agentId, id);
        console.log("attached", spec.name, attached);
      }
    } catch (err) {
      console.warn(`Add "${spec.name}" in the OmniDimension dashboard if this failed:`, err instanceof Error ? err.message : err);
      console.warn(JSON.stringify(spec, null, 2));
    }
  }

  const logFile = fileURLToPath(new URL("../../data/setup-log.txt", import.meta.url));
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${new Date().toISOString()} agent=${agentId} public=${config.publicUrl}\n`);
  console.log("Done. OMNIDIM_AGENT_ID written to .env");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
