-- eRegistration: a shareable, unauthenticated temp link letting a guest fill in their
-- own registration-card data (identity, ID/passport photo, live signature) before/at
-- arrival. Additive only — the existing check-in transition is untouched; front desk
-- still reviews and applies each guest's submission via the Check-in Wizard.

ALTER TABLE "ProfileDocument" ADD COLUMN "documentImageStoragePath" TEXT;

ALTER TABLE "EnterpriseSettings" ADD COLUMN "eRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "eRegistrationExpiryHours" INTEGER NOT NULL DEFAULT 72;
ALTER TABLE "EnterpriseSettings" ADD COLUMN "eRegistrationMessage" TEXT;

CREATE TABLE "ERegistrationLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT,
    "groupBlockId" TEXT,
    "propertyId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" DATETIME NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "revokedAt" DATETIME,
    "revokedByUserId" TEXT,
    "lastAccessedAt" DATETIME,
    CONSTRAINT "ERegistrationLink_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ERegistrationLink_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ERegistrationLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ERegistrationLink_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ERegistrationLink_tokenHash_key" ON "ERegistrationLink"("tokenHash");
CREATE INDEX "ERegistrationLink_reservationId_idx" ON "ERegistrationLink"("reservationId");
CREATE INDEX "ERegistrationLink_groupBlockId_idx" ON "ERegistrationLink"("groupBlockId");

CREATE TABLE "ERegistrationGuestSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "linkId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "existingProfileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "firstName" TEXT,
    "middleName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" DATETIME,
    "nationality" TEXT,
    "gender" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "addressFull" TEXT,
    "addressCity" TEXT,
    "addressCountry" TEXT,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "issuingCountry" TEXT,
    "documentIssueDate" DATETIME,
    "documentExpiryDate" DATETIME,
    "idPhotoPath" TEXT,
    "idPhotoMimeType" TEXT,
    "signatureDataUrl" TEXT,
    "submittedAt" DATETIME,
    "submittedIp" TEXT,
    "submittedUserAgent" TEXT,
    "appliedAt" DATETIME,
    "appliedByUserId" TEXT,
    "childrenInfo" TEXT,
    CONSTRAINT "ERegistrationGuestSlot_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ERegistrationLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ERegistrationGuestSlot_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ERegistrationGuestSlot_existingProfileId_fkey" FOREIGN KEY ("existingProfileId") REFERENCES "Profile" ("upid") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ERegistrationGuestSlot_reservationId_slotIndex_key" ON "ERegistrationGuestSlot"("reservationId", "slotIndex");
CREATE INDEX "ERegistrationGuestSlot_linkId_idx" ON "ERegistrationGuestSlot"("linkId");
