import { canDial } from "../compliance/calling.ts";
import { placeOutboundCall } from "../adapters/telephony.ts";
import { activeProject } from "../packs/real-estate/project.ts";
import { pack } from "../packs/active.ts";
import { store } from "../store.ts";

const SLA_MS = 120_000;

export function startLeadQueueWorker() {
  setInterval(() => {
    drainQueue().catch((err) => {
      store.log("queue_fail", err instanceof Error ? err.message : String(err));
    });
  }, 5_000);
}

async function drainQueue() {
  if (store.liveCall()) return;
  const next = store.queuedLeads()[0];
  if (!next) return;
  if (next.campaignId) {
    const campaign = store.getCampaign(next.campaignId);
    if (!campaign || campaign.status !== "running") return;
  }

  const gate = canDial({ phone: next.phone, consentSource: next.consentSource, playbook: next.playbook });
  if (!gate.ok) {
    store.upsertLead({ id: next.id, status: gate.reason, skipReason: gate.reason });
    store.log("dial_skip", `${next.phone} ${gate.reason}`, next.id);
    return;
  }

  const waitMs = Date.now() - new Date(next.ingestedAt).getTime();
  const id = `out-${Date.now()}`;
  const now = new Date().toISOString();
  store.upsertLead({ id: next.id, status: "dialing", firstRingAt: now, waitMs, lastCallId: id });
  store.upsertCall({ id, to: next.phone, status: "dialing", leadId: next.id, direction: "outbound" });

  const p = pack().id === "real-estate" ? activeProject() : null;
  try {
    const placed = await placeOutboundCall(next.phone, {
      lead_name: next.name ?? "",
      lead_id: next.id,
      our_call_id: id,
      playbook: next.playbook,
      consent_source: next.consentSource,
      locality: next.locality ?? "",
      bhk: next.bhk ?? "",
      budget: next.budget ?? "",
      city: next.city ?? p?.city ?? "",
      project_name: p?.name ?? "",
      builder: p?.builder ?? "",
    });
    const call = placed.call as { id?: string; requestId?: string | number };
    const remoteId = String(call.id ?? call.requestId ?? id);
    store.upsertCall({
      id: remoteId,
      to: next.phone,
      status: "dialing",
      provider: placed.provider,
      remoteId,
      leadId: next.id,
      direction: "outbound",
    });
    store.upsertLead({ id: next.id, lastCallId: remoteId });
    const sla = waitMs <= SLA_MS ? "within_sla" : "sla_miss";
    store.log("dial", `${placed.provider} ${next.phone} wait=${waitMs}ms ${sla}`, remoteId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    store.upsertLead({ id: next.id, status: "failed", skipReason: error });
    store.upsertCall({ id, status: "failed" });
    store.log("dial_fail", error, id);
  }
}
