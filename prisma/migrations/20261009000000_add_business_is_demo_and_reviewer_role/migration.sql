-- Add isDemo to Business
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- Allow 'reviewer' role in UserBusiness
ALTER TABLE "UserBusiness" DROP CONSTRAINT IF EXISTS "UserBusiness_role_check";
ALTER TABLE "UserBusiness" ADD CONSTRAINT "UserBusiness_role_check" CHECK ("role" IN ('owner', 'admin', 'staff', 'reviewer'));
