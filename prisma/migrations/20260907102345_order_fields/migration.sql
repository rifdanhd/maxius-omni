/*
  Warnings:

  - Added the required column `channelSku` to the `OrderItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN "buyerEmail" TEXT;
ALTER TABLE "Order" ADD COLUMN "createTime" DATETIME;
ALTER TABLE "Order" ADD COLUMN "currency" TEXT;
ALTER TABLE "Order" ADD COLUMN "paidTime" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "qty" INTEGER NOT NULL,
    "price" REAL,
    "channelSku" TEXT NOT NULL,
    "productId" TEXT,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OrderItem" ("id", "orderId", "price", "qty", "variantId") SELECT "id", "orderId", "price", "qty", "variantId" FROM "OrderItem";
DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
