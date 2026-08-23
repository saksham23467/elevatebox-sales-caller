import { config } from "../config.ts";
import { store } from "../store.ts";
import { placeOutboundCall } from "../vapi/placeCall.ts";

export function startCallbackWorker() {
  setInterval(async () => {
    const due = store.dueCallbacks();
    for (const call of due) {
      store.log("callback_dispatch", `redialing ${call.to}`, call.id);
      try {
        store.upsertCall({ id: `${call.id}-cb-${Date.now()}`, to: call.to, status: "dialing" });
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
