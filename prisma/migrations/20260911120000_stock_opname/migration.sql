-- CreateTable
CREATE TABLE "StockOpname" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" DATETIME,
    "cancelledAt" DATETIME,
    "userId" TEXT,
    CONSTRAINT "StockOpname_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockOpnameItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "opnameId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "systemStock" INTEGER NOT NULL,
    "countedStock" INTEGER,
    CONSTRAINT "StockOpnameItem_opnameId_fkey" FOREIGN KEY ("opnameId") REFERENCES "StockOpname" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockOpnameItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StockOpname_code_key" ON "StockOpname"("code");

-- CreateIndex
CREATE INDEX "StockOpname_status_startedAt_idx" ON "StockOpname"("status", "startedAt");

-- CreateIndex
CREATE INDEX "StockOpnameItem_variantId_idx" ON "StockOpnameItem"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockOpnameItem_opnameId_variantId_key" ON "StockOpnameItem"("opnameId", "variantId");

