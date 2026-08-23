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
