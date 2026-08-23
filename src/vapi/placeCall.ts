import { config } from "../config.ts";
import { dispatchCall as dispatchOmnidim } from "../omnidim/client.ts";
import { dispatchVapiCall } from "./client.ts";

export async function placeOutboundCall(to: string, context?: Record<string, string>) {
  if (config.omnidimKey && config.agentId) {
    const call = await dispatchOmnidim({ to, context });
    return { provider: "omnidim" as const, call };
  }
  if (config.vapiKey && config.vapiAssistantId && config.vapiPhoneNumberId) {
    const call = await dispatchVapiCall({
      to,
      assistantId: config.vapiAssistantId,
      phoneNumberId: config.vapiPhoneNumberId,
    });
    return { provider: "vapi" as const, call };
  }
  const missing = [];
  if (!config.omnidimKey) missing.push("OMNIDIM_API_KEY");
  if (config.omnidimKey && !config.agentId) missing.push("run npm run setup-agent");
  if (!config.vapiKey) missing.push("or VAPI_API_KEY");
  throw new Error(`No dialer ready. ${missing.join("; ")}`);
}
