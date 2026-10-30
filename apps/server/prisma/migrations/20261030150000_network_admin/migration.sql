-- Netzwerk-Admin-Rollenmodell: Admin auf allen verbundenen Servern.
ALTER TABLE "User" ADD COLUMN "networkAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Das bisherige beidseitige Opt-in entfällt (Netzwerk-Admins verwalten alle ACTIVE-Server; BLOCKED bleibt Notaus).
ALTER TABLE "FederatedServer" DROP COLUMN "adminGranted";
ALTER TABLE "FederatedServer" DROP COLUMN "adminAllowed";
