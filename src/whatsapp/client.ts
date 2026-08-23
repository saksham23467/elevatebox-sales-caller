import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode";
import pino from "pino";
import { config, paths, toE164 } from "../config.ts";
import type { Lang } from "./copy.ts";

const log = pino({ level: "info" }).child({ mod: "whatsapp" });

let sock: WASocket | null = null;
let lastQr: string | null = null;
let status: "starting" | "qr" | "ready" | "logged_out" = "starting";
let lastError: string | null = null;
const lastPacketAt = new Map<string, number>();
const inflight = new Set<string>();
const DEDUPE_MS = 8 * 60 * 1000;

function jid(phone: string): string {
  const e164 = toE164(phone).replace("+", "");
  return `${e164}@s.whatsapp.net`;
}

async function connect() {
  mkdirSync(fileURLToPath(paths.waAuth), { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(fileURLToPath(paths.waAuth));
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["ElevateBox Voice", "Chrome", "124"],
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      lastQr = await qrcode.toDataURL(qr);
      status = "qr";
      log.info("WhatsApp QR ready — scan from the dashboard");
    }
    if (connection === "open") {
      status = "ready";
      lastQr = null;
      lastError = null;
      log.info("WhatsApp connected");
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        status = "logged_out";
        lastError = "WhatsApp logged out. Scan QR again.";
        sock = null;
        return;
      }
      status = "starting";
      setTimeout(() => connect().catch((err) => log.error(err)), 2000);
    }
  });
}

export function whatsappStatus() {
  return { status, qr: lastQr, error: lastError };
}

export async function startWhatsApp() {
  if (!sock) await connect();
}

export async function sendWhatsApp(opts: {
  to: string;
  text: string;
  includeResume?: boolean;
  includeArchitecture?: boolean;
  lang?: Lang;
}): Promise<{ ok: boolean; error?: string }> {
  if (!sock || status !== "ready") {
    return { ok: false, error: `WhatsApp not ready (${status})` };
  }
  const to = jid(opts.to);
  if (inflight.has(to) || Date.now() - (lastPacketAt.get(to) ?? 0) < DEDUPE_MS) {
    log.info({ to }, "WhatsApp skipped — already sent to this number");
    return { ok: true };
  }
  inflight.add(to);
  try {
    await sock.sendMessage(to, { text: opts.text });
    try {
      await sock.sendMessage(to, {
        contacts: {
          displayName: config.candidateName,
          contacts: [{ vcard: sakshamVcard() }],
        },
      });
    } catch (err) {
      log.warn({ err }, "vCard send failed — text still went out");
    }
    if (opts.includeArchitecture) {
      const cap =
        opts.lang === "hi"
          ? "yeh us call ka wiring hai jo abhi laga"
          : opts.lang === "te"
            ? "ippudu jarugutunna call ela work avutundo"
            : "the call on your phone right now. this is how it was built";
      await sock.sendMessage(to, {
        image: readFileSync(fileURLToPath(paths.architecture)),
        caption: cap,
      });
    }
    if (opts.includeResume) {
      await sock.sendMessage(to, {
        document: readFileSync(fileURLToPath(paths.resume)),
        mimetype: "application/pdf",
        fileName: "Saksham_Bansal_Resume.pdf",
        caption: config.candidateName,
      });
    }
    lastPacketAt.set(to, Date.now());
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ error }, "WhatsApp send failed");
    return { ok: false, error };
  } finally {
    inflight.delete(to);
  }
}

function sakshamVcard(): string {
  const digits = config.candidatePhone.replace(/\D/g, "");
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${config.candidateName}`,
    `TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}`,
    "END:VCARD",
  ].join("\n");
}
