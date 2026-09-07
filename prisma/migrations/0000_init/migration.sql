-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "accessToken" TEXT
);

-- CreateTable
CREATE TABLE "PlatformCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "shopId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MasterProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 20
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelSku" TEXT NOT NULL,
    "masterProductId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    CONSTRAINT "ProductMapping_masterProductId_fkey" FOREIGN KEY ("masterProductId") REFERENCES "MasterProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductMapping_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qty" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "critical" BOOLEAN NOT NULL,
    "text" TEXT NOT NULL,
    "channelSku" TEXT NOT NULL,
    "masterProductId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    CONSTRAINT "SalesLog_masterProductId_fkey" FOREIGN KEY ("masterProductId") REFERENCES "MasterProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCredential_platform_shopId_key" ON "PlatformCredential"("platform", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_accountId_channelSku_key" ON "ProductMapping"("accountId", "channelSku");

