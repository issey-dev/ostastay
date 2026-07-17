-- AlterTable
ALTER TABLE "EnterpriseSettings" ADD COLUMN "themeColor" TEXT NOT NULL DEFAULT 'indigo';
ALTER TABLE "EnterpriseSettings" ADD COLUMN "smtpHost" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "smtpPort" INTEGER;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "smtpUsername" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "smtpPassword" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "smtpFromAddress" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "smtpUseTls" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "sftpHost" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "sftpPort" INTEGER;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "sftpUsername" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "sftpPassword" TEXT;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "sftpRemotePath" TEXT;
