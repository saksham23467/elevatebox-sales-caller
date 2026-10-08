import { config } from "../config.ts";
import type { Qualification } from "../qualify/classify.ts";
import { pack } from "../packs/active.ts";
import { cloudTemplateVars } from "../packs/real-estate/copy.ts";
import { sendWhatsApp, whatsappStatus } from "../whatsapp/client.ts";
import type { Lang } from "../whatsapp/copy.ts";
import type { PacketKind } from "../packs/types.ts";

export type SendResult = { ok: boolean; sent?: boolean; error?: string; channel?: string };

function digits(phone: string) {
  return phone.replace(/\D/g, "");
}

function templateLang(lang?: Lang) {
  if (lang === "hi") return "hi";
  if (lang === "te") return "te";
  return "en";
}

async function sendCloudTemplate(opts: {
  to: string;
  name: string;
  lang?: Lang;
  params: string[];
}): Promise<SendResult> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${config.whatsappCloudPhoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappCloudToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: digits(opts.to),
      type: "template",
      template: {
        name: opts.name,
        language: { code: templateLang(opts.lang) },
        components: opts.params.length
          ? [
              {
                type: "body",
                parameters: opts.params.map((text) => ({ type: "text", text })),
              },
            ]
          : [],
      },
    }),
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, sent: false, error: body.slice(0, 300), channel: "whatsapp_cloud" };
  return { ok: true, sent: true, channel: "whatsapp_cloud" };
}

async function sendCloudText(to: string, text: string): Promise<SendResult> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${config.whatsappCloudPhoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappCloudToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: digits(to),
      type: "text",
      text: { body: text },
    }),
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, sent: false, error: body.slice(0, 300), channel: "whatsapp_cloud" };
  return { ok: true, sent: true, channel: "whatsapp_cloud" };
}

async function sendSms(to: string, text: string): Promise<SendResult> {
  if (!config.twilioSid || !config.twilioToken || !config.twilioFrom) {
    return { ok: false, sent: false, error: "SMS adapter not configured (TWILIO_*)", channel: "sms" };
  }
  const auth = Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: config.twilioFrom, Body: text.slice(0, 1500) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const body = await res.text();
  if (!res.ok) return { ok: false, sent: false, error: body.slice(0, 300), channel: "sms" };
  return { ok: true, sent: true, channel: "sms" };
}

export function needsBaileys(): boolean {
  if (config.market === "us") return false;
  return !config.whatsappCloudToken || !config.whatsappCloudPhoneId;
}

export function messagingStatus() {
  if (config.market === "us") {
    return { channel: "sms" as const, ready: Boolean(config.twilioSid && config.twilioFrom), cloud: false };
  }
  if (config.whatsappCloudToken && config.whatsappCloudPhoneId) {
    return { channel: "whatsapp_cloud" as const, ready: true, cloud: true };
  }
  return { channel: "whatsapp_baileys" as const, ready: whatsappStatus().status === "ready", cloud: false };
}

export async function sendPacket(opts: {
  to: string;
  text: string;
  q?: Qualification;
  kind?: PacketKind;
  lang?: Lang;
  includeArchitecture?: boolean;
  force?: boolean;
  visitLabel?: string;
}): Promise<SendResult> {
  const vertical = pack();
  if (config.market === "us") return sendSms(opts.to, opts.text);

  if (config.whatsappCloudToken && config.whatsappCloudPhoneId) {
    const vars = opts.q && vertical.id === "real-estate" ? cloudTemplateVars(opts.q, opts.visitLabel) : null;
    const templateName =
      opts.kind === "visit" && config.whatsappTemplateVisit
        ? config.whatsappTemplateVisit
        : config.whatsappTemplateBrochure;
    if (templateName && vars) {
      const templated = await sendCloudTemplate({
        to: opts.to,
        name: templateName,
        lang: opts.lang,
        params: [vars.project, vars.rm, vars.pin, vars.slot || vars.bhk].filter(Boolean),
      });
      if (templated.ok) return templated;
    }
    const texted = await sendCloudText(opts.to, opts.text);
    if (texted.ok) return texted;
    if (!needsBaileys()) return texted;
  }

  return sendWhatsApp({
    to: opts.to,
    text: opts.text,
    includeArchitecture: opts.includeArchitecture ?? Boolean(vertical.packetAttachments.architecture),
    lang: opts.lang,
    force: opts.force,
  });
}
