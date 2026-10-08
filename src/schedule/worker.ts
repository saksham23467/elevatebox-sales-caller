import { placeOutboundCall } from "../adapters/telephony.ts";
import { canDial } from "../compliance/calling.ts";
import { store } from "../store.ts";

export function startCallbackWorker() {
  setInterval(async () => {
    const due = store.dueCallbacks();
    for (const call of due) {
      if (!canDial({ phone: call.to }).ok) {
        store.log("callback_skip", `outside hours or DND ${call.to}`, call.id);
        continue;
      }
      store.log("callback_dispatch", `redialing ${call.to}`, call.id);
      try {
        store.upsertCall({ id: `${call.id}-cb-${Date.now()}`, to: call.to, status: "dialing", direction: "outbound" });
        await placeOutboundCall(call.to, {
          is_callback: "true",
          previous_notes: JSON.stringify(call.qualification ?? {}),
        });
        store.upsertCall({ id: call.id, callbackAt: undefined, status: "completed" });
      } catch (err) {
        store.log("callback_dispatch_fail", err instanceof Error ? err.message : String(err), call.id);
      }
    }
  }, 30_000);
}
