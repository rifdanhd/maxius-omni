-- CreateTable
CREATE TABLE "ShipmentTrackingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipmentId" TEXT NOT NULL,
    "actionCode" INTEGER,
    "description" TEXT NOT NULL,
    "eventTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentTrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ShipmentTrackingEvent_shipmentId_eventTime_idx" ON "ShipmentTrackingEvent"("shipmentId", "eventTime");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentTrackingEvent_shipmentId_eventTime_description_key" ON "ShipmentTrackingEvent"("shipmentId", "eventTime", "description");

