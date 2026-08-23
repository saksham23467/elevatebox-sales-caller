import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../config.ts";
import { assistantConfig } from "./assistant.ts";
import { VapiError, listAssistants, listPhoneNumbers, vapi, vapiAuthHint, type VapiPhoneNumber } from "./client.ts";

function envFile() {
  return fileURLToPath(new URL("../../.env", import.meta.url));
}

function setEnv(key: string, value: string) {
  const path = envFile();
  let env = readFileSync(path, "utf8");
  if (new RegExp(`^${key}=`, "m").test(env)) env = env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
  else env += `\n${key}=${value}\n`;
  writeFileSync(path, env);
}

async function main() {
  if (!config.vapiKey) throw new Error("Set VAPI_API_KEY in .env");
  if (config.publicUrl.includes("localhost")) {
    console.warn("PUBLIC_URL is localhost. Start a tunnel so Vapi can hit /webhooks/vapi mid-call, then re-run setup-vapi.");
  }
  try {
    const existing = (await listAssistants()).find((a) => a.name?.includes("Saksham Ecom"));
    const payload = assistantConfig();
    const assistant = existing?.id
      ? await vapi<{ id: string }>(`/assistant/${existing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await vapi<{ id: string }>("/assistant", { method: "POST", body: JSON.stringify(payload) });
    setEnv("VAPI_ASSISTANT_ID", assistant.id);
    console.log("Assistant", assistant.id, existing ? "updated" : "created");

    let numbers = await listPhoneNumbers();
    if (numbers.length === 0) {
      console.log("No numbers on the account. Creating a free Vapi US number (cannot call +91)...");
      let created: VapiPhoneNumber | undefined;
      const areaCodes = ["843", "513", "440", "415", "212"];
      for (const area of areaCodes) {
        try {
          created = await vapi<VapiPhoneNumber>("/phone-number", {
            method: "POST",
            body: JSON.stringify({
              provider: "vapi",
              numberDesiredAreaCode: area,
              name: "ElevateBox outbound",
              assistantId: assistant.id,
            }),
          });
          break;
        } catch (err) {
          console.warn("area", area, err instanceof Error ? err.message : err);
        }
      }
      if (!created) throw new Error("Could not create a free Vapi number. Create one in dashboard.vapi.ai → Phone Numbers.");
      numbers = [created];
    }
    console.log(
      "Phone numbers:",
      numbers.map((n) => `${n.id} ${n.number ?? n.name ?? ""}`).join("\n") || "(none)",
    );
    const chosen = numbers[0];
    if (chosen?.id) {
      setEnv("VAPI_PHONE_NUMBER_ID", chosen.id);
      console.log("Wrote VAPI_PHONE_NUMBER_ID", chosen.id, chosen.number ?? "");
      if (!chosen.number || chosen.number.startsWith("+1")) {
        console.warn(
          "Free Vapi numbers are US-only and cannot dial +91. Import a Twilio/Exotel/Telnyx number with India calling, then set VAPI_PHONE_NUMBER_ID.",
        );
      }
    }
  } catch (err) {
    if (err instanceof VapiError) {
      console.error(vapiAuthHint(err));
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
