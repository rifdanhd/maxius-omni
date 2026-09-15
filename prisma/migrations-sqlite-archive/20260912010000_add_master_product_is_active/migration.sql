-- AlterTable: MasterProduct (visibilitas soft delete; existing otomatis aktif)
ALTER TABLE "MasterProduct" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
