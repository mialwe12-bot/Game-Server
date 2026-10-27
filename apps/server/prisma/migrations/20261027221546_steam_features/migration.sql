-- CreateEnum
CREATE TYPE "WorkshopKind" AS ENUM ('MOD', 'MAP', 'OTHER');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('GIVE', 'RECEIVE');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('ADULT', 'CHILD');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "ageRating" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "savePaths" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "workshopPath" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CloudSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "deviceName" TEXT,
    "platform" "Platform",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CloudSave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "apiName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "iconKey" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "progressMax" INTEGER,
    "detection" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'sdk',

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("userId","achievementId")
);

-- CreateTable
CREATE TABLE "GameToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopItem" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "authorId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "WorkshopKind" NOT NULL DEFAULT 'MOD',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "previewKey" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkshopItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopVersion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "changelog" TEXT NOT NULL DEFAULT '',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopRating" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "up" BOOLEAN NOT NULL,

    CONSTRAINT "WorkshopRating_pkey" PRIMARY KEY ("itemId","userId")
);

-- CreateTable
CREATE TABLE "WorkshopComment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkshopSubscription" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkshopSubscription_pkey" PRIMARY KEY ("itemId","userId")
);

-- CreateTable
CREATE TABLE "TradingCard" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardItem" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "foil" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'drop',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardDropState" (
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "drops" INTEGER NOT NULL DEFAULT 0,
    "creditedSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CardDropState_pkey" PRIMARY KEY ("userId","gameId")
);

-- CreateTable
CREATE TABLE "GameBadge" (
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "foil" BOOLEAN NOT NULL DEFAULT false,
    "craftedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameBadge_pkey" PRIMARY KEY ("userId","gameId")
);

-- CreateTable
CREATE TABLE "TradeOffer" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "TradeOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOfferItem" (
    "offerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,

    CONSTRAINT "TradeOfferItem_pkey" PRIMARY KEY ("offerId","itemId")
);

-- CreateTable
CREATE TABLE "MarketListing" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "wantCardId" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'OPEN',
    "buyerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MarketListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maxAgeRating" INTEGER NOT NULL DEFAULT 18,
    "dailyMinutes" INTEGER,
    "chatAllowed" BOOLEAN NOT NULL DEFAULT true,
    "communityAllowed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("familyId","userId")
);

-- CreateTable
CREATE TABLE "FamilyInvite" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gift" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "fromId" TEXT,
    "toId" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "batch" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeRedemption" (
    "codeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeRedemption_pkey" PRIMARY KEY ("codeId","userId")
);

-- CreateTable
CREATE TABLE "GameNote" (
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameNote_pkey" PRIMARY KEY ("userId","gameId")
);

-- CreateIndex
CREATE INDEX "CloudSave_userId_gameId_createdAt_idx" ON "CloudSave"("userId", "gameId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CloudSave_userId_gameId_version_key" ON "CloudSave"("userId", "gameId", "version");

-- CreateIndex
CREATE INDEX "Achievement_gameId_sortOrder_idx" ON "Achievement"("gameId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_gameId_apiName_key" ON "Achievement"("gameId", "apiName");

-- CreateIndex
CREATE INDEX "UserAchievement_achievementId_unlockedAt_idx" ON "UserAchievement"("achievementId", "unlockedAt");

-- CreateIndex
CREATE INDEX "UserAchievement_userId_unlockedAt_idx" ON "UserAchievement"("userId", "unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameToken_tokenHash_key" ON "GameToken"("tokenHash");

-- CreateIndex
CREATE INDEX "GameToken_userId_idx" ON "GameToken"("userId");

-- CreateIndex
CREATE INDEX "WorkshopItem_gameId_createdAt_idx" ON "WorkshopItem"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopVersion_itemId_createdAt_idx" ON "WorkshopVersion"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkshopVersion_itemId_version_key" ON "WorkshopVersion"("itemId", "version");

-- CreateIndex
CREATE INDEX "WorkshopComment_itemId_createdAt_idx" ON "WorkshopComment"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkshopSubscription_userId_idx" ON "WorkshopSubscription"("userId");

-- CreateIndex
CREATE INDEX "TradingCard_gameId_sortOrder_idx" ON "TradingCard"("gameId", "sortOrder");

-- CreateIndex
CREATE INDEX "CardItem_ownerId_cardId_idx" ON "CardItem"("ownerId", "cardId");

-- CreateIndex
CREATE INDEX "TradeOffer_toId_status_idx" ON "TradeOffer"("toId", "status");

-- CreateIndex
CREATE INDEX "TradeOffer_fromId_status_idx" ON "TradeOffer"("fromId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketListing_itemId_key" ON "MarketListing"("itemId");

-- CreateIndex
CREATE INDEX "MarketListing_status_wantCardId_idx" ON "MarketListing"("status", "wantCardId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyMember_userId_key" ON "FamilyMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyInvite_familyId_userId_key" ON "FamilyInvite"("familyId", "userId");

-- CreateIndex
CREATE INDEX "Gift_toId_openedAt_idx" ON "Gift"("toId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationCode_code_key" ON "ActivationCode"("code");

-- CreateIndex
CREATE INDEX "ActivationCode_gameId_batch_idx" ON "ActivationCode"("gameId", "batch");

-- AddForeignKey
ALTER TABLE "CloudSave" ADD CONSTRAINT "CloudSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloudSave" ADD CONSTRAINT "CloudSave_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameToken" ADD CONSTRAINT "GameToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameToken" ADD CONSTRAINT "GameToken_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopItem" ADD CONSTRAINT "WorkshopItem_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopItem" ADD CONSTRAINT "WorkshopItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopVersion" ADD CONSTRAINT "WorkshopVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorkshopItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopRating" ADD CONSTRAINT "WorkshopRating_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorkshopItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopRating" ADD CONSTRAINT "WorkshopRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopComment" ADD CONSTRAINT "WorkshopComment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorkshopItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopComment" ADD CONSTRAINT "WorkshopComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopSubscription" ADD CONSTRAINT "WorkshopSubscription_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorkshopItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkshopSubscription" ADD CONSTRAINT "WorkshopSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingCard" ADD CONSTRAINT "TradingCard_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardItem" ADD CONSTRAINT "CardItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardItem" ADD CONSTRAINT "CardItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TradingCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardDropState" ADD CONSTRAINT "CardDropState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardDropState" ADD CONSTRAINT "CardDropState_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBadge" ADD CONSTRAINT "GameBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameBadge" ADD CONSTRAINT "GameBadge_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOfferItem" ADD CONSTRAINT "TradeOfferItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "TradeOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOfferItem" ADD CONSTRAINT "TradeOfferItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CardItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CardItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketListing" ADD CONSTRAINT "MarketListing_wantCardId_fkey" FOREIGN KEY ("wantCardId") REFERENCES "TradingCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeRedemption" ADD CONSTRAINT "CodeRedemption_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "ActivationCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeRedemption" ADD CONSTRAINT "CodeRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameNote" ADD CONSTRAINT "GameNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameNote" ADD CONSTRAINT "GameNote_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
