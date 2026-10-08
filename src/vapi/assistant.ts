import { config } from "../config.ts";
import { pack } from "../packs/active.ts";

export function assistantConfig() {
  const vertical = pack();
  const qualProps = Object.fromEntries(
    vertical.toolQual.map((p) => [p.key, { type: p.type, description: p.description }]),
  );
  const server = {
    url: `${config.publicUrl}/webhooks/vapi`,
    timeoutSeconds: 20,
    secret: config.toolSecret,
  };
  return {
    name: vertical.agentTitle,
    firstMessage: vertical.welcomeMessage,
    firstMessageInterruptionsEnabled: true,
    backgroundSound: "office",
    silenceTimeoutSeconds: 8,
    maxDurationSeconds: 240,
    endCallPhrases: ["goodbye", "bye", "that's all"],
    voicemailDetection: {
      provider: "vapi",
      backoffPlan: { startAtSeconds: 1.5, frequencySeconds: 2.5, maxRetries: 8 },
    },
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
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [{ role: "system", content: vertical.systemPrompt() }],
      tools: [
        {
          type: "function",
          async: true,
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
              "Call when the lead is HOT or asked for details. Sends WhatsApp (text + contact, no resume) then keep talking.",
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
        {
          type: "voicemail",
          function: {
            name: "end_on_voicemail",
            description: "Silently end the call when you hear voicemail or an answering machine. Do not leave a message.",
          },
          messages: [],
        },
      ],
    },
    server,
    serverMessages: ["tool-calls", "end-of-call-report", "status-update"],
  };
}
