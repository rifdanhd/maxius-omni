import { after } from "next/server";
import { drainStockOutbox } from "@/lib/services/stock-outbox.service";
import { processDueSyncJobs } from "@/lib/services/sync-job.service";

export function dispatchInventoryAfterResponse(businessId: string) {
  after(async () => {
    try {
      await drainStockOutbox(200, businessId);
      await processDueSyncJobs({ businessId });
    } catch {
      console.error("[Inventory] Pengiriman tertunda; worker akan mencoba lagi dari outbox.");
    }
  });
}
