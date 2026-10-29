-- Föderation Stufe 3: Dedup-ID für serverübergreifend zugestellte Nachrichten
ALTER TABLE "Message" ADD COLUMN "federationId" TEXT;
CREATE UNIQUE INDEX "Message_federationId_key" ON "Message"("federationId");
