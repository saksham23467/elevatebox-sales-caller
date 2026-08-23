import { config } from "../config.ts";
import { systemPrompt, welcomeMessage } from "../omnidim/prompt.ts";

const qualProps = {
  classification: { type: "string", description: "hot, warm, or cold from buying intent, not politeness" },
  quotes: { type: "string", description: "verbatim phrases the lead said, separated by |" },
  budget: { type: "string", description: "budget they mentioned" },
  products: { type: "string", description: "what they sell" },
  catalog_size: { type: "string", description: "how many products if mentioned" },
  timeline: { type: "string", description: "when they need the site live" },
  features: { type: "string", description: "features they asked for" },
  barrier: { type: "string", description: "why they cannot buy now, if any" },
  language: { type: "string", description: "en, hi, or te" },
};

export function assistantConfig() {
  const server = {
    url: `${config.publicUrl}/webhooks/vapi`,
    timeoutSeconds: 20,
    secret: config.toolSecret,
  };
  return {
    name: "Saksham Ecom Sales — Ananya",
    firstMessage: welcomeMessage,
    firstMessageInterruptionsEnabled: true,
    backgroundSound: "office",
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 420,
    endCallPhrases: ["goodbye", "bye", "that's all"],
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "multi",
    },
    voice: {
      provider: "11labs",
      voiceId: "EXAVITQu4vr4xnSDxMaL",
      stability: 0.4,
      similarityBoost: 0.75,
    },
    model: {
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.35,
      messages: [{ role: "system", content: systemPrompt() }],
      tools: [
        {
          type: "function",
          async: false,
          function: {
            name: "classify_lead",
            description: "Call as soon as you can tell hot, warm, or cold. Pass their actual words in quotes.",
            parameters: {
              type: "object",
              properties: qualProps,
              required: ["classification", "quotes"],
            },
          },
        },
        {
          type: "function",
          async: true,
          function: {
            name: "send_whatsapp",
            description:
              "Fire DURING the call when intent is HOT or they asked for details. Do not wait until hangup. Then confirm out loud that WhatsApp is going out.",
            parameters: {
              type: "object",
              properties: qualProps,
              required: ["classification", "quotes"],
            },
          },
        },
        {
          type: "function",
          async: false,
          function: {
            name: "book_callback",
            description:
              "Call when the lead names a callback time, including tomorrow morning or kal subah. Pass spoken_time as their exact words.",
            parameters: {
              type: "object",
              properties: {
                ...qualProps,
                spoken_time: { type: "string", description: "Exact words they used for the callback time" },
              },
              required: ["spoken_time"],
            },
          },
        },
        { type: "endCall" },
      ],
    },
    server,
    serverMessages: ["tool-calls", "end-of-call-report", "status-update"],
  };
}
