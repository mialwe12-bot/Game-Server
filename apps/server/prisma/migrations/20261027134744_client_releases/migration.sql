-- CreateEnum
CREATE TYPE "ClientFileFormat" AS ENUM ('MSI', 'NSIS', 'APPIMAGE', 'DEB', 'RPM', 'DMG', 'APP_TARBALL');

-- CreateTable
CREATE TABLE "ClientRelease" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientReleaseFile" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "arch" TEXT NOT NULL DEFAULT 'x86_64',
    "format" "ClientFileFormat" NOT NULL,
    "filename" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientReleaseFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientRelease_version_key" ON "ClientRelease"("version");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReleaseFile_releaseId_platform_arch_format_key" ON "ClientReleaseFile"("releaseId", "platform", "arch", "format");

-- AddForeignKey
ALTER TABLE "ClientReleaseFile" ADD CONSTRAINT "ClientReleaseFile_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ClientRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;
