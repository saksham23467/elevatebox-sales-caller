import { config } from "../config.ts";

const BASE = "https://api.vapi.ai";

export class VapiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`Vapi ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export async function vapi<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!config.vapiKey) throw new Error("VAPI_API_KEY is missing");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.vapiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new VapiError(res.status, body);
  return body as T;
}

export function vapiAuthHint(err: VapiError): string {
  if (err.status !== 401 && err.status !== 403) return err.message;
  return "Vapi rejected this key for server API calls. In dashboard.vapi.ai go to Vapi API Keys and paste the Private key (not Public) into VAPI_API_KEY.";
}

export type VapiPhoneNumber = { id: string; number?: string; name?: string; provider?: string };
export type VapiAssistant = { id: string; name?: string };

export async function listPhoneNumbers(): Promise<VapiPhoneNumber[]> {
  const data = await vapi<VapiPhoneNumber[] | { results?: VapiPhoneNumber[] }>("/phone-number");
  return Array.isArray(data) ? data : (data.results ?? []);
}

export async function listAssistants(): Promise<VapiAssistant[]> {
  const data = await vapi<VapiAssistant[] | { results?: VapiAssistant[] }>("/assistant");
  return Array.isArray(data) ? data : (data.results ?? []);
}

export async function dispatchVapiCall(opts: { to: string; assistantId: string; phoneNumberId: string }) {
  return vapi("/call", {
    method: "POST",
    body: JSON.stringify({
      assistantId: opts.assistantId,
      phoneNumberId: opts.phoneNumberId,
      customer: { number: opts.to },
    }),
  });
}

export async function probeVapi(): Promise<{
  ok: boolean;
  error?: string;
  numbers: VapiPhoneNumber[];
  assistants: number;
}> {
  if (!config.vapiKey) return { ok: false, error: "VAPI_API_KEY missing", numbers: [], assistants: 0 };
  try {
    const [numbers, assistants] = await Promise.all([listPhoneNumbers(), listAssistants()]);
    return { ok: true, numbers, assistants: assistants.length };
  } catch (err) {
    if (err instanceof VapiError) return { ok: false, error: vapiAuthHint(err), numbers: [], assistants: 0 };
    return { ok: false, error: err instanceof Error ? err.message : String(err), numbers: [], assistants: 0 };
  }
}
