-- Föderation Stufe 2: Schatten-Konten verbundener Heimat-Server
ALTER TABLE "User" ADD COLUMN "federationServerId" TEXT,
ADD COLUMN "federationUserId" TEXT;

CREATE UNIQUE INDEX "User_federationServerId_federationUserId_key" ON "User"("federationServerId", "federationUserId");

ALTER TABLE "User" ADD CONSTRAINT "User_federationServerId_fkey" FOREIGN KEY ("federationServerId") REFERENCES "FederatedServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
