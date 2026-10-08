import { Boom } from "@hapi/boom";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode";
import pino from "pino";
import { config, paths, toE164 } from "../config.ts";
import type { Lang } from "./copy.ts";

const log = pino({ level: "info" }).child({ mod: "whatsapp" });

process.on("unhandledRejection", (err) => {
  log.error({ err }, "WhatsApp promise rejected — keeping the dashboard up");
});
process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Connection Closed|Timed Out|Socket closed|Stream Errored/i.test(msg)) {
    log.error({ err }, "WhatsApp socket died — reconnecting");
    sock = null;
    status = "starting";
    setTimeout(() => connect().catch((e) => log.error(e)), 2000);
    return;
  }
  throw err;
});

let sock: WASocket | null = null;
let lastQr: string | null = null;
let status: "starting" | "qr" | "ready" | "logged_out" = "starting";
let lastError: string | null = null;
const lastPacketAt = new Map<string, number>();
const inflight = new Set<string>();
const DEDUPE_MS = 90 * 1000;

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
      lastError = null;
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
        const dir = fileURLToPath(paths.waAuth);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        setTimeout(() => connect().catch((err) => log.error(err)), 800);
        return;
      }
      status = "starting";
      setTimeout(() => connect().catch((err) => log.error(err)), 2000);
    }
  });
}

export function whatsappStatus() {
  return { status, qr: lastQr, error: lastError, me: linkedNumber() };
}

function linkedNumber(): string | null {
  const id = sock?.user?.id;
  if (!id) return null;
  const digits = id.split(":")[0]?.replace(/\D/g, "") ?? "";
  return digits.length >= 10 ? `+${digits}` : null;
}

export async function startWhatsApp() {
  if (!sock) await connect();
}

export async function logoutWhatsApp() {
  try {
    await sock?.logout();
  } catch {
    /* already dead */
  }
  sock = null;
  lastQr = null;
  lastError = null;
  lastPacketAt.clear();
  inflight.clear();
  status = "starting";
  const dir = fileURLToPath(paths.waAuth);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await connect();
  return whatsappStatus();
}

export async function sendWhatsApp(opts: {
  to: string;
  text: string;
  includeArchitecture?: boolean;
  lang?: Lang;
  force?: boolean;
}): Promise<{ ok: boolean; sent?: boolean; error?: string }> {
  if (!sock || status !== "ready") {
    return { ok: false, sent: false, error: `WhatsApp not ready (${status})` };
  }
  const mine = linkedNumber();
  const dest = toE164(opts.to);
  if (mine && dest && mine.replace(/\D/g, "") === dest.replace(/\D/g, "")) {
    log.warn({ dest }, "WhatsApp session is this same number — self-chat often does not show");
  }
  const to = jid(opts.to);
  if (!opts.force && (inflight.has(to) || Date.now() - (lastPacketAt.get(to) ?? 0) < DEDUPE_MS)) {
    log.info({ to }, "WhatsApp skipped — already sent to this number");
    return { ok: true, sent: false, error: "already_sent" };
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
    lastPacketAt.set(to, Date.now());
    return { ok: true, sent: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ error }, "WhatsApp send failed");
    return { ok: false, sent: false, error };
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
