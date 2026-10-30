-- Fern-Administration (beidseitiges Opt-in)
ALTER TABLE "FederatedServer"
  ADD COLUMN "adminGranted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "adminAllowed" BOOLEAN NOT NULL DEFAULT false;
