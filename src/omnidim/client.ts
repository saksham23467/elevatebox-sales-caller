import OmniDimension from "@omnidim-ai/sdk";
import { config } from "../config.ts";

export function omnidim() {
  if (!config.omnidimKey) {
    throw new Error("OMNIDIM_API_KEY is missing. Create an account at https://omnidim.io/api-management");
  }
  return new OmniDimension({ apiKey: config.omnidimKey });
}

export async function dispatchCall(opts: { to: string; agentId?: string; context?: Record<string, string> }) {
  const client = omnidim();
  const agentId = Number(opts.agentId ?? config.agentId);
  if (!agentId) throw new Error("OMNIDIM_AGENT_ID is missing. Run npm run setup-agent");
  return client.calls.dispatch({
    agent_id: agentId,
    to_number: opts.to,
    call_context: opts.context,
  });
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

/** Browser voice session. Same agent, no phone ring. The page only receives wsUrl. */
export async function createBrowserSession(variables?: Record<string, string>) {
  if (!config.omnidimKey) throw new Error("OMNIDIM_API_KEY is missing");
  const agentId = Number(config.agentId);
  if (!agentId) throw new Error("OMNIDIM_AGENT_ID is missing. Run npm run setup-agent");
  const res = (await omnidimFetch("POST", "/sessions/create", {
    agent_id: agentId,
    type: "voice",
    custom_variables: variables ?? {},
  })) as { ws_url?: string; expires_at?: string };
  if (!res.ws_url) throw new Error("OmniDim did not open a browser session");
  return { wsUrl: res.ws_url, expiresAt: res.expires_at ?? null };
}

/** Cut an in-progress OmniDimension PSTN call. Official REST has no hangup route; try the live control URL. */
export async function hangupOmnidimCall(remoteId: string) {
  const ids = [remoteId];
  try {
    const logs = (await omnidimFetch("GET", "/calls/logs?pagesize=15&page=1")) as {
      call_log_data?: Array<Record<string, unknown>>;
    };
    for (const row of logs.call_log_data ?? []) {
      const request = row.call_request_id;
      const reqId =
        request && typeof request === "object"
          ? String((request as { id?: unknown }).id ?? "")
          : String(request ?? "");
      if (reqId && reqId !== remoteId && String(row.id) !== remoteId) continue;
      for (const key of ["id", "call_sid", "call_id"]) {
        const v = row[key];
        if (v != null && String(v)) ids.push(String(v));
      }
    }
  } catch {
    /* logs are optional */
  }

  const unique = [...new Set(ids.filter(Boolean))];
  for (const id of unique) {
    const qs = new URLSearchParams({
      omni_status: "call_end",
      call_request_id: id,
      request_id: id,
      call_id: id,
      call_sid: id,
    });
    try {
      const res = await fetch(`https://live.omnidim.io/should_end_the_call?${qs}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.omnidimKey}`,
          Accept: "application/json",
        },
      });
      const text = await res.text();
      if (res.ok) return { ok: true as const, via: "should_end_the_call", id, body: text.slice(0, 200) };
    } catch {
      /* try next id */
    }
  }
  throw new Error("OmniDimension did not accept a hangup control. Say goodbye on the line, or press End after Ananya hangs up.");
}
