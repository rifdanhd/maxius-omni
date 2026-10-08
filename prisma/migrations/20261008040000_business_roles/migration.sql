ALTER TABLE "UserBusiness" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE "UserBusiness" ADD CONSTRAINT "UserBusiness_role_check" CHECK ("role" IN ('owner', 'admin', 'staff'));
-- Preserve the existing bootstrap administrator, without promoting other members.
UPDATE "UserBusiness" m SET "role"='owner' FROM "User" u WHERE u."id"=m."userId" AND u."username"='admin';
CREATE FUNCTION maxius_revoke_changed_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "User" SET "tokenVersion"="tokenVersion"+1 WHERE "id"=OLD."userId";
    RETURN OLD;
  END IF;
  IF NEW."role" IS DISTINCT FROM OLD."role" THEN
    UPDATE "User" SET "tokenVersion"="tokenVersion"+1 WHERE "id"=NEW."userId";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "UserBusiness_revoke_changes" AFTER UPDATE OR DELETE ON "UserBusiness"
FOR EACH ROW EXECUTE FUNCTION maxius_revoke_changed_membership();
