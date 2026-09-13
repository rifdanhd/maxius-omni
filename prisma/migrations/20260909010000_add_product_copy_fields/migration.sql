-- AlterTable
ALTER TABLE "MasterProduct" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "MasterProduct" ADD COLUMN "importedFrom" TEXT;
