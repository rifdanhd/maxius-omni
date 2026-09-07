-- AlterTable
ALTER TABLE "Order" ADD COLUMN "recommendedShippingTime" DATETIME;
ALTER TABLE "Order" ADD COLUMN "rtsSlaTime" DATETIME;
ALTER TABLE "Order" ADD COLUMN "shippingDueTime" DATETIME;
ALTER TABLE "Order" ADD COLUMN "ttsSlaTime" DATETIME;
