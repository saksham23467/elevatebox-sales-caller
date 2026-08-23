import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export function toE164(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  openaiKey: required("OPENAI_API_KEY"),
  omnidimKey: process.env.OMNIDIM_API_KEY?.trim() ?? "",
  agentId: process.env.OMNIDIM_AGENT_ID?.trim() ?? "",
  vapiKey: process.env.VAPI_API_KEY?.trim() ?? "",
  vapiAssistantId: process.env.VAPI_ASSISTANT_ID?.trim() ?? "",
  vapiPhoneNumberId: process.env.VAPI_PHONE_NUMBER_ID?.trim() ?? "",
  leadPhone: toE164(process.env.LEAD_PHONE ?? "+918688664337"),
  candidatePhone: toE164(process.env.CANDIDATE_PHONE ?? "+919354632052"),
  candidateName: process.env.CANDIDATE_NAME ?? "Saksham Bansal",
  toolSecret: required("TOOL_SECRET", "elevatebox_tool_7f3a9c2e1b"),
  timezone: process.env.TZ ?? "Asia/Kolkata",
};

export const paths = {
  resume: new URL("../public/Saksham_Bansal_Resume.pdf", import.meta.url),
  architecture: new URL("../public/architecture.jpg", import.meta.url),
  publicDir: new URL("../public/", import.meta.url),
  dataDir: new URL("../data/", import.meta.url),
  waAuth: new URL("../whatsapp-auth/", import.meta.url),
};
