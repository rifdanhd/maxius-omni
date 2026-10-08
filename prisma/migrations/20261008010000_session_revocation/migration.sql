ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ALTER COLUMN "canViewFullPii" SET DEFAULT false;

CREATE FUNCTION maxius_revoke_changed_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash"
     OR NEW."canViewFullPii" IS DISTINCT FROM OLD."canViewFullPii" THEN
    NEW."tokenVersion" := OLD."tokenVersion" + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "User_revoke_sensitive_changes" BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION maxius_revoke_changed_user();
