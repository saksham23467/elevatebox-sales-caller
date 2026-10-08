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
  if (digits.startsWith("0") && digits.length === 11) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

function csvList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw?.trim()) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
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
  vertical: (process.env.VERTICAL?.trim() === "ecommerce" ? "ecommerce" : "real-estate") as "ecommerce" | "real-estate",
  market: (process.env.MARKET?.trim() === "us" ? "us" : "india") as "india" | "us",
  whatsappCloudToken: process.env.WHATSAPP_CLOUD_TOKEN?.trim() ?? "",
  whatsappCloudPhoneId: process.env.WHATSAPP_CLOUD_PHONE_ID?.trim() ?? "",
  whatsappTemplateBrochure: process.env.WHATSAPP_TEMPLATE_BROCHURE?.trim() ?? "",
  whatsappTemplateVisit: process.env.WHATSAPP_TEMPLATE_VISIT?.trim() ?? "",
  twilioSid: process.env.TWILIO_ACCOUNT_SID?.trim() ?? "",
  twilioToken: process.env.TWILIO_AUTH_TOKEN?.trim() ?? "",
  twilioFrom: process.env.TWILIO_FROM?.trim() ?? "",
  reBuilder: process.env.RE_BUILDER_NAME?.trim() || "Aarav Estates",
  reProject: process.env.RE_PROJECT_NAME?.trim() || "Aarav Greens",
  reCity: process.env.RE_PROJECT_CITY?.trim() || "Hyderabad",
  reLocalities: csvList(process.env.RE_LOCALITIES, ["Gachibowli", "Financial District"]),
  reBhkMix: process.env.RE_BHK_MIX?.trim() || "2 & 3 BHK",
  rePriceBand: process.env.RE_PRICE_BAND?.trim() || "₹1.2–1.8 Cr",
  reBrochureUrl: process.env.RE_BROCHURE_URL?.trim() || "",
  reLocationPin: process.env.RE_LOCATION_PIN?.trim() || "https://maps.google.com/?q=Gachibowli+Hyderabad",
  reRmName: process.env.RE_RM_NAME?.trim() || process.env.CANDIDATE_NAME?.trim() || "Saksham Bansal",
  reRmPhone: toE164(process.env.RE_RM_PHONE?.trim() || process.env.CANDIDATE_PHONE || "+919354632052"),
  omnidimPhoneId: process.env.OMNIDIM_PHONE_NUMBER_ID?.trim() ?? "",
  omnidimPhoneNumber: process.env.OMNIDIM_PHONE_NUMBER?.trim() ?? "",
  allowAfterHours: process.env.ALLOW_AFTER_HOURS !== "false",
  dashboardPassword: process.env.DASHBOARD_PASSWORD?.trim() ?? "",
  metaPageToken: process.env.META_PAGE_ACCESS_TOKEN?.trim() ?? "",
};

export const paths = {
  resume: new URL("../public/Saksham_Bansal_Resume.pdf", import.meta.url),
  architecture: new URL("../public/architecture.jpg", import.meta.url),
  publicDir: new URL("../public/", import.meta.url),
  dataDir: new URL("../data/", import.meta.url),
  waAuth: new URL("../whatsapp-auth/", import.meta.url),
};
