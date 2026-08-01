/*
  Warnings:

  - You are about to drop the `EnterpriseModuleAccess` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TierModuleAccess` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "EnterpriseModuleAccess";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "TierModuleAccess";
PRAGMA foreign_keys=on;
