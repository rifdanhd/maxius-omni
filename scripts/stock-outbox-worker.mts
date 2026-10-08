import { setTimeout } from "node:timers/promises";
import { drainStockOutbox } from "../lib/services/stock-outbox.service";
import { processDueSyncJobs } from "../lib/services/sync-job.service";
import { prisma } from "../lib/db/prisma";
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });
try {
  do {
    try {
      const dispatched = await drainStockOutbox();
      const result = await processDueSyncJobs();
      console.log(JSON.stringify({ dispatched, ...result }));
    } catch (error) { console.error("stock worker tick failed", error); }
    if (process.argv.includes("--once") || stopped) break;
    await setTimeout(5000);
  } while (!stopped);
} finally { await prisma.$disconnect(); }
