-- CreateTable
CREATE TABLE "Enterprise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enterprise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseLicense" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'STANDARD',
    "maxProperties" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "monthlyPrice" DOUBLE PRECISION,
    "priceCurrency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyLicenseAllowance" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "maxRoomTypes" INTEGER,
    "maxRooms" INTEGER,
    "maxChannels" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyLicenseAllowance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseInvoice" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "receiptNo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canCreate" BOOLEAN NOT NULL DEFAULT false,
    "canUpdate" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAccessGrant" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemCode" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SystemCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NightAuditLog" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "auditDate" TIMESTAMP(3) NOT NULL,
    "runByUserId" TEXT NOT NULL,
    "foliosUpdated" INTEGER NOT NULL DEFAULT 0,
    "noShowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NightAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'ENTERPRISE',
    "propertyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "checkInTime" TEXT NOT NULL,
    "checkOutTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "logoUrl" TEXT,
    "taxId" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "starRating" INTEGER,
    "bannerColor" TEXT,
    "stationeryFont" TEXT DEFAULT 'Geist',
    "requireInspectionOnCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "eodHousekeepingMode" TEXT NOT NULL DEFAULT 'OFF',
    "eodHousekeepingTargetStatus" TEXT,
    "pricesIncludeTaxes" BOOLEAN NOT NULL DEFAULT true,
    "allocationCalculationMode" TEXT NOT NULL DEFAULT 'RATE_PLAN',
    "businessDate" TIMESTAMP(3),
    "eodSessionsInvalidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Floor" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomType" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxOccupancy" INTEGER NOT NULL,
    "baseOccupancy" INTEGER NOT NULL DEFAULT 2,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPseudo" BOOLEAN NOT NULL DEFAULT false,
    "housekeepingEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RoomType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomTypeFeature" (
    "id" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "RoomTypeFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "floorId" TEXT,
    "roomNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLEAN',
    "oooReason" TEXT,
    "oooExpectedReturn" TIMESTAMP(3),
    "assignedAttendantId" TEXT,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomFeature" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "RoomFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "taxProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Tax',
    "ratePercent" DOUBLE PRECISION NOT NULL,
    "calculateOn" TEXT NOT NULL DEFAULT 'BASE',
    "order" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeGroup" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportBucket" TEXT NOT NULL,
    "isRevenue" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ChargeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeSubgroup" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "chargeGroupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "outletId" TEXT,

    CONSTRAINT "ChargeSubgroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeCode" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chargeSubgroupId" TEXT NOT NULL,
    "postingType" TEXT NOT NULL DEFAULT 'CHARGE',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "useDefaultTax" BOOLEAN NOT NULL DEFAULT true,
    "taxProfileId" TEXT,

    CONSTRAINT "ChargeCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeCodeGenerate" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "generatorCodeId" TEXT NOT NULL,
    "generatedCodeId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "calculateOn" TEXT NOT NULL DEFAULT 'NET',
    "basisGenerateId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ChargeCodeGenerate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "chargeCodeId" TEXT,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "upid" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "profileType" TEXT NOT NULL DEFAULT 'GUEST',
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'REGULAR',
    "photoUrl" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "nationality" TEXT,
    "anniversaryDate" TIMESTAMP(3),
    "vipLevel" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "iataNumber" TEXT,
    "commissionRate" DOUBLE PRECISION,
    "greenTaxExempt" BOOLEAN NOT NULL DEFAULT false,
    "gender" TEXT,
    "membershipNumber" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "isIncognito" BOOLEAN NOT NULL DEFAULT false,
    "arNumber" TEXT,
    "creditLimit" DOUBLE PRECISION,
    "isCreditAccount" BOOLEAN NOT NULL DEFAULT false,
    "totalStays" INTEGER NOT NULL DEFAULT 0,
    "totalNights" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "lastStayDate" TIMESTAMP(3),
    "originPropertyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("upid")
);

-- CreateTable
CREATE TABLE "ProfileCommunication" (
    "id" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileCommunication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileAddress" (
    "id" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fullAddress" TEXT NOT NULL,
    "city" TEXT,
    "stateProvince" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileAttachment" (
    "id" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfilePreference" (
    "id" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ProfilePreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileDocument" (
    "id" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "issuingCountry" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "documentImageUrl" TEXT,
    "documentImageStoragePath" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileNote" (
    "id" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "noteText" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatePlan" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isNegotiated" BOOLEAN NOT NULL DEFAULT false,
    "isComplimentary" BOOLEAN NOT NULL DEFAULT false,
    "isHouseUse" BOOLEAN NOT NULL DEFAULT false,
    "chargeCodeId" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "parentRatePlanId" TEXT,
    "derivedAdjustmentType" TEXT,
    "derivedAdjustmentValue" DOUBLE PRECISION,

    CONSTRAINT "RatePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCalendar" (
    "id" TEXT NOT NULL,
    "ratePlanId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "extraAdultPrice" DOUBLE PRECISION,
    "extraChildPrice" DOUBLE PRECISION,

    CONSTRAINT "PriceCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityRestriction" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "roomTypeId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "confirmationNo" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "primaryGuestId" TEXT NOT NULL,
    "travelAgentId" TEXT,
    "groupBlockId" TEXT,
    "groupBillToMaster" BOOLEAN NOT NULL DEFAULT true,
    "checkInDate" TIMESTAMP(3) NOT NULL,
    "checkOutDate" TIMESTAMP(3) NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "depositFeeRuleId" TEXT,
    "cancellationFeeRuleId" TEXT,
    "noShowFeeRuleId" TEXT,
    "advanceBilledThrough" TIMESTAMP(3),
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "infants" INTEGER NOT NULL DEFAULT 0,
    "mealPlan" TEXT NOT NULL DEFAULT 'NONE',
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "noShowAt" TIMESTAMP(3),
    "remarks" TEXT,
    "hasScheduledRoomMove" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationTransport" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "transportType" TEXT,
    "carrierCode" TEXT,
    "carrierTime" TIMESTAMP(3),
    "transportNo" TEXT,
    "transportTime" TIMESTAMP(3),
    "remarks" TEXT,
    "chargeToGuest" BOOLEAN NOT NULL DEFAULT false,
    "chargeCodeId" TEXT,
    "chargeAmount" DOUBLE PRECISION,
    "chargedLineItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationTransport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationSpecialRequest" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationSpecialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folio" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT,
    "propertyId" TEXT NOT NULL,
    "folioNumber" INTEGER NOT NULL DEFAULT 1,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedBusinessDate" TIMESTAMP(3),
    "isMaster" BOOLEAN NOT NULL DEFAULT false,
    "settlementMethod" TEXT NOT NULL DEFAULT 'DIRECT',
    "isDebtorAccount" BOOLEAN NOT NULL DEFAULT false,
    "walkInGuestName" TEXT,
    "walkInGuestContact" TEXT,
    "payeeProfileId" TEXT,
    "groupBlockId" TEXT,
    "taxInvoiceNumber" TEXT,
    "proformaInvoiceNumber" TEXT,

    CONSTRAINT "Folio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolioLineItem" (
    "id" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "outletId" TEXT,
    "outletCheckId" TEXT,
    "roomAssignmentId" TEXT,
    "shiftId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "serviceChargeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isVoid" BOOLEAN NOT NULL DEFAULT false,
    "generatedFromLineItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolioLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolioRoutingRule" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "targetFolioId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolioRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierShift" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "propertyId" TEXT,
    "businessDate" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingFloat" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "closingDrop" DOUBLE PRECISION,

    CONSTRAINT "CashierShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierPaidOut" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashierPaidOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "chargeCodeId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "referenceNumber" TEXT,
    "isRefund" BOOLEAN NOT NULL DEFAULT false,
    "depositPurpose" TEXT,
    "receiptNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyFeeRule" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "ruleType" TEXT NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'FLAT',
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chargeCodeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyFeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyExchange" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "guestName" TEXT,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amountFrom" DOUBLE PRECISION NOT NULL,
    "amountTo" DOUBLE PRECISION NOT NULL,
    "receiptNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "CurrencyExchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "outletType" TEXT NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "code" TEXT,
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "taxNo" TEXT,
    "checkSequence" INTEGER NOT NULL DEFAULT 0,
    "taxOverrideMode" TEXT NOT NULL DEFAULT 'NONE',
    "taxProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletChargeCode" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "chargeCodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletChargeCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletCheck" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "folioId" TEXT,
    "checkNumber" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseSettings" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "resConfirmPrefix" TEXT NOT NULL DEFAULT '',
    "resConfirmLength" INTEGER NOT NULL DEFAULT 6,
    "cashierDefaultFloat" DOUBLE PRECISION NOT NULL DEFAULT 300,
    "exchangeFromCurrency" TEXT NOT NULL DEFAULT 'USD',
    "exchangeToCurrency" TEXT NOT NULL DEFAULT 'MVR',
    "systemDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "defaultAccommodationChargeCodeId" TEXT,
    "defaultGreenTaxChargeCodeId" TEXT,
    "cityLedgerPaymentMethodId" TEXT,
    "commissionChargeCodeId" TEXT,
    "invoiceBrandName" TEXT,
    "invoiceLogoUrl" TEXT,
    "invoiceBrandColor" TEXT DEFAULT '#4f46e5',
    "invoiceFontFamily" TEXT DEFAULT 'Geist',
    "invoiceTaxId" TEXT,
    "invoicePhone" TEXT,
    "invoiceEmail" TEXT,
    "invoiceAddress" TEXT,
    "defaultFolioStyle" TEXT NOT NULL DEFAULT 'detailed',
    "spaOutletId" TEXT,
    "excursionOutletId" TEXT,
    "invoiceHeaderText" TEXT,
    "invoiceFooterText" TEXT,
    "invoicePaymentTerms" TEXT,
    "invoicePaymentAccountName" TEXT,
    "invoicePaymentAccountNumber" TEXT,
    "invoicePaymentIban" TEXT,
    "invoicePaymentBankInfo" TEXT,
    "receiptFooterText" TEXT,
    "receiptTerms" TEXT,
    "statementFooterText" TEXT,
    "statementTerms" TEXT,
    "confirmationLetterMessage" TEXT,
    "registrationCardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "registrationCardMessage" TEXT,
    "registrationCardTerms" TEXT,
    "eRegistrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eRegistrationExpiryHours" INTEGER NOT NULL DEFAULT 72,
    "eRegistrationMessage" TEXT,
    "greenTaxEnabled" BOOLEAN NOT NULL DEFAULT true,
    "greenTaxAdultAmount" DOUBLE PRECISION NOT NULL DEFAULT 12.00,
    "greenTaxChildAmount" DOUBLE PRECISION NOT NULL DEFAULT 6.00,
    "greenTaxExemptAge" INTEGER NOT NULL DEFAULT 2,
    "tgstEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tgstRate" DOUBLE PRECISION NOT NULL DEFAULT 17.00,
    "serviceChargeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "serviceChargeRate" DOUBLE PRECISION NOT NULL DEFAULT 10.00,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUsername" TEXT,
    "smtpPassword" TEXT,
    "smtpFromAddress" TEXT,
    "smtpUseTls" BOOLEAN NOT NULL DEFAULT true,
    "sftpHost" TEXT,
    "sftpPort" INTEGER,
    "sftpUsername" TEXT,
    "sftpPassword" TEXT,
    "sftpRemotePath" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationTrace" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "traceType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actionDate" TIMESTAMP(3),
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "alertOnOpen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMaintenance" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "issueType" TEXT NOT NULL DEFAULT 'GENERAL',
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reportedBy" TEXT,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccompanyingGuest" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccompanyingGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ERegistrationLink" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT,
    "groupBlockId" TEXT,
    "propertyId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "lastAccessedAt" TIMESTAMP(3),

    CONSTRAINT "ERegistrationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ERegistrationGuestSlot" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "existingProfileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "firstName" TEXT,
    "middleName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
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
    "documentIssueDate" TIMESTAMP(3),
    "documentExpiryDate" TIMESTAMP(3),
    "idPhotoPath" TEXT,
    "idPhotoMimeType" TEXT,
    "signatureDataUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedIp" TEXT,
    "submittedUserAgent" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedByUserId" TEXT,
    "childrenInfo" TEXT,

    CONSTRAINT "ERegistrationGuestSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAssignment" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "roomId" TEXT,
    "roomTypeId" TEXT NOT NULL,
    "chargeRoomTypeId" TEXT,
    "ratePlanId" TEXT NOT NULL,
    "overrideRate" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingTask" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'FULL_SERVICE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "scheduledDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousekeepingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAttendant" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "zone" TEXT,

    CONSTRAINT "RoomAttendant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupBlock" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "cutoffDate" TIMESTAMP(3),
    "totalRoomsHeld" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'TENTATIVE',
    "payeeProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupBlockRoom" (
    "id" TEXT NOT NULL,
    "groupBlockId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GroupBlockRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyNightAuditLog" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "auditDate" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedBy" TEXT,
    "roomsOccupied" INTEGER NOT NULL,
    "roomRevenue" DOUBLE PRECISION NOT NULL,
    "taxPosted" DOUBLE PRECISION NOT NULL,
    "totalPostings" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',

    CONSTRAINT "PropertyNightAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EodRun" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "startedByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "departuresAt" TIMESTAMP(3),
    "cashierAt" TIMESTAMP(3),
    "postAt" TIMESTAMP(3),
    "registrationAt" TIMESTAMP(3),
    "reportsAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EodRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertySequence" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sequenceType" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "resetYear" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertySequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestRegistration" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "registrationNo" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EodReport" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "reportType" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EodReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserActivityLog" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "userName" TEXT,
    "isSupport" BOOLEAN NOT NULL DEFAULT false,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "description" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "chargeCodeId" TEXT NOT NULL,
    "postingRhythm" TEXT NOT NULL DEFAULT 'EVERY_NIGHT',
    "mode" TEXT NOT NULL DEFAULT 'ADD_TO_RATE',
    "sellSeparate" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationRate" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "adultPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "childPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "AllocationRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatePlanAllocation" (
    "id" TEXT NOT NULL,
    "ratePlanId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatePlanAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatePlanAgentAccess" (
    "id" TEXT NOT NULL,
    "ratePlanId" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "commissionRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RatePlanAgentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanAllocation" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealPlanAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationAllocation" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "overrideAdultPrice" DOUBLE PRECISION,
    "overrideChildPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseAddonAccess" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseAddonAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcursionType" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "chargeCodeId" TEXT NOT NULL,
    "pricingMode" TEXT NOT NULL DEFAULT 'PER_PERSON',
    "cutoffHours" INTEGER NOT NULL DEFAULT 24,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExcursionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcursionRate" (
    "id" TEXT NOT NULL,
    "excursionTypeId" TEXT NOT NULL,
    "adultPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "childPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "infantPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "flatPrice" DOUBLE PRECISION,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "ExcursionRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcursionSchedule" (
    "id" TEXT NOT NULL,
    "excursionTypeId" TEXT NOT NULL,
    "daysOfWeek" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "meetingTime" TEXT,
    "meetingPoint" TEXT,
    "capacity" INTEGER NOT NULL,
    "minCapacity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExcursionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcursionDeparture" (
    "id" TEXT NOT NULL,
    "excursionTypeId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "departureDate" TIMESTAMP(3) NOT NULL,
    "departureTime" TEXT NOT NULL,
    "meetingTime" TEXT,
    "meetingPoint" TEXT,
    "capacity" INTEGER NOT NULL,
    "minCapacity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExcursionDeparture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExcursionBooking" (
    "id" TEXT NOT NULL,
    "departureId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reservationId" TEXT,
    "walkInGuestName" TEXT,
    "walkInGuestContact" TEXT,
    "adultCount" INTEGER NOT NULL DEFAULT 1,
    "childCount" INTEGER NOT NULL DEFAULT 0,
    "infantCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "folioId" TEXT NOT NULL,
    "folioLineItemId" TEXT,
    "refundPaymentId" TEXT,
    "notes" TEXT,
    "bookedByUserId" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "movedFromDepartureId" TEXT,
    "movedToBookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExcursionBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTreatmentCategory" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaTreatmentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTreatment" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "description" TEXT,
    "defaultDurationMinutes" INTEGER NOT NULL,
    "preparationBufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "cleanupBufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "chargeCodeId" TEXT NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 1,
    "pricingMode" TEXT NOT NULL DEFAULT 'PER_PERSON',
    "allowWalkIn" BOOLEAN NOT NULL DEFAULT true,
    "allowInHouseGuest" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaTreatment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTreatmentRate" (
    "id" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaTreatmentRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTherapist" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bookable" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaTherapist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTherapistTreatment" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "qualified" BOOLEAN NOT NULL DEFAULT true,
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "customDurationMinutes" INTEGER,
    "notes" TEXT,

    CONSTRAINT "SpaTherapistTreatment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaRoom" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "roomType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bookable" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTreatmentRoom" (
    "id" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "preferred" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SpaTreatmentRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTherapistSchedule" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SpaTherapistSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaTherapistAvailabilityException" (
    "id" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "exceptionType" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaTherapistAvailabilityException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaRoomAvailabilityException" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "exceptionType" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpaRoomAvailabilityException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaSettings" (
    "propertyId" TEXT NOT NULL,
    "defaultOpeningTime" TEXT NOT NULL DEFAULT '09:00',
    "defaultClosingTime" TEXT NOT NULL DEFAULT '18:00',
    "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "defaultPreparationBufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "defaultCleanupBufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "allowTentativeAppointments" BOOLEAN NOT NULL DEFAULT true,
    "tentativeHoldMinutes" INTEGER NOT NULL DEFAULT 20,
    "requireTherapistAtBooking" BOOLEAN NOT NULL DEFAULT true,
    "requireRoomAtBooking" BOOLEAN NOT NULL DEFAULT true,
    "allowAutoAssignment" BOOLEAN NOT NULL DEFAULT true,
    "chargeTiming" TEXT NOT NULL DEFAULT 'AT_BOOKING',
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 4,
    "lateCancellationChargeType" TEXT NOT NULL DEFAULT 'NONE',
    "lateCancellationChargeValue" DOUBLE PRECISION,
    "noShowChargeType" TEXT NOT NULL DEFAULT 'NONE',
    "noShowChargeValue" DOUBLE PRECISION,
    "noShowGraceMinutes" INTEGER NOT NULL DEFAULT 15,
    "requireCancellationReason" BOOLEAN NOT NULL DEFAULT true,
    "requireRescheduleReason" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaSettings_pkey" PRIMARY KEY ("propertyId")
);

-- CreateTable
CREATE TABLE "SpaAppointment" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "treatmentNameSnapshot" TEXT NOT NULL,
    "durationMinutesSnapshot" INTEGER NOT NULL,
    "preparationBufferMinutesSnapshot" INTEGER NOT NULL,
    "cleanupBufferMinutesSnapshot" INTEGER NOT NULL,
    "partySize" INTEGER NOT NULL DEFAULT 1,
    "priceSnapshot" DOUBLE PRECISION NOT NULL,
    "currencySnapshot" TEXT NOT NULL,
    "appointmentDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "treatmentEndTime" TEXT NOT NULL,
    "blockedUntilTime" TEXT NOT NULL,
    "roomId" TEXT,
    "appointmentStatus" TEXT NOT NULL DEFAULT 'TENTATIVE',
    "paymentStatus" TEXT NOT NULL DEFAULT 'NOT_POSTED',
    "source" TEXT NOT NULL DEFAULT 'FRONT_DESK',
    "folioId" TEXT,
    "folioLineItemId" TEXT,
    "refundPaymentId" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "cancellationReasonCode" TEXT,
    "cancellationNotes" TEXT,
    "bookedByUserId" TEXT NOT NULL,
    "cancelledByUserId" TEXT,
    "completedByUserId" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "treatmentStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "noShowAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaAppointmentParticipant" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "participantIndex" INTEGER NOT NULL DEFAULT 1,
    "reservationId" TEXT,
    "walkInGuestName" TEXT,
    "walkInGuestContact" TEXT,
    "therapistId" TEXT,
    "requestedTherapistId" TEXT,
    "requestedGender" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaAppointmentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaGuestTherapistPreference" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "therapistId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaGuestTherapistPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'BEDS24',
    "name" TEXT NOT NULL,
    "refreshToken" TEXT,
    "lastTokenRefreshAt" TIMESTAMP(3),
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "webhookToken" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "rateLimitTotal" INTEGER,
    "rateLimitRemaining" INTEGER,
    "rateLimitResetsAt" TIMESTAMP(3),
    "rateLimitObservedAt" TIMESTAMP(3),
    "rateLimitPauseThreshold" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelPropertyLink" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "externalPropertyId" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelPropertyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelRoomTypeMap" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "externalRoomId" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ChannelRoomTypeMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelRatePlanMap" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "ratePlanId" TEXT NOT NULL,
    "externalRateId" TEXT NOT NULL,

    CONSTRAINT "ChannelRatePlanMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSyncLog" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "connectionId" TEXT,
    "connectionName" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "endpoint" TEXT,
    "ok" BOOLEAN NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER,
    "requestSummary" TEXT,
    "responseSummary" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelInboundBooking" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalBookingId" TEXT NOT NULL,
    "channelName" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "reservationId" TEXT,
    "externalRoomId" TEXT,
    "roomTypeId" TEXT,
    "propertyId" TEXT,
    "guestFirstName" TEXT,
    "guestLastName" TEXT,
    "guestEmail" TEXT,
    "arrival" TIMESTAMP(3),
    "departure" TIMESTAMP(3),
    "adults" INTEGER,
    "children" INTEGER,
    "totalAmount" DOUBLE PRECISION,
    "currency" TEXT,
    "channelStatus" TEXT,
    "problem" TEXT,
    "isOverbooking" BOOLEAN NOT NULL DEFAULT false,
    "overbookingNote" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "rawPayload" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelInboundBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelBookingDefaults" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "ratePlanId" TEXT,
    "mealPlanCode" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelBookingDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Enterprise_slug_key" ON "Enterprise"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "EnterpriseLicense_enterpriseId_key" ON "EnterpriseLicense"("enterpriseId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyLicenseAllowance_propertyId_key" ON "PropertyLicenseAllowance"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseInvoice_invoiceNo_key" ON "LicenseInvoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseInvoice_receiptNo_key" ON "LicenseInvoice"("receiptNo");

-- CreateIndex
CREATE INDEX "LicenseInvoice_enterpriseId_issuedAt_idx" ON "LicenseInvoice"("enterpriseId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_enterpriseId_name_key" ON "Role"("enterpriseId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_module_key" ON "RolePermission"("roleId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "SystemCode_enterpriseId_category_code_key" ON "SystemCode"("enterpriseId", "category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Property_code_key" ON "Property"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RoomTypeFeature_roomTypeId_category_code_key" ON "RoomTypeFeature"("roomTypeId", "category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MealPlan_propertyId_code_key" ON "MealPlan"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Room_propertyId_roomNumber_key" ON "Room"("propertyId", "roomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RoomFeature_roomId_category_code_key" ON "RoomFeature"("roomId", "category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeGroup_enterpriseId_code_key" ON "ChargeGroup"("enterpriseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeSubgroup_enterpriseId_code_key" ON "ChargeSubgroup"("enterpriseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeCode_enterpriseId_code_key" ON "ChargeCode"("enterpriseId", "code");

-- CreateIndex
CREATE INDEX "ChargeCodeGenerate_enterpriseId_generatorCodeId_idx" ON "ChargeCodeGenerate"("enterpriseId", "generatorCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeCodeGenerate_generatorCodeId_generatedCodeId_key" ON "ChargeCodeGenerate"("generatorCodeId", "generatedCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_arNumber_key" ON "Profile"("arNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileDocument_upid_documentType_documentNumber_key" ON "ProfileDocument"("upid", "documentType", "documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlan_propertyId_code_key" ON "RatePlan"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCalendar_ratePlanId_roomTypeId_date_key" ON "PriceCalendar"("ratePlanId", "roomTypeId", "date");

-- CreateIndex
CREATE INDEX "AvailabilityRestriction_propertyId_date_idx" ON "AvailabilityRestriction"("propertyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityRestriction_propertyId_roomTypeId_date_key" ON "AvailabilityRestriction"("propertyId", "roomTypeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_confirmationNo_key" ON "Reservation"("confirmationNo");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationTransport_reservationId_direction_key" ON "ReservationTransport"("reservationId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationSpecialRequest_reservationId_code_key" ON "ReservationSpecialRequest"("reservationId", "code");

-- CreateIndex
CREATE INDEX "Folio_propertyId_idx" ON "Folio"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "FolioRoutingRule_reservationId_chargeCodeId_key" ON "FolioRoutingRule"("reservationId", "chargeCodeId");

-- CreateIndex
CREATE INDEX "CashierShift_propertyId_idx" ON "CashierShift"("propertyId");

-- CreateIndex
CREATE INDEX "CashierShift_userId_idx" ON "CashierShift"("userId");

-- CreateIndex
CREATE INDEX "PropertyFeeRule_propertyId_ruleType_idx" ON "PropertyFeeRule"("propertyId", "ruleType");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_propertyId_name_key" ON "Outlet"("propertyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_propertyId_code_key" ON "Outlet"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "OutletChargeCode_outletId_chargeCodeId_key" ON "OutletChargeCode"("outletId", "chargeCodeId");

-- CreateIndex
CREATE INDEX "OutletCheck_folioId_idx" ON "OutletCheck"("folioId");

-- CreateIndex
CREATE INDEX "OutletCheck_propertyId_idx" ON "OutletCheck"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "OutletCheck_outletId_checkNumber_key" ON "OutletCheck"("outletId", "checkNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EnterpriseSettings_enterpriseId_key" ON "EnterpriseSettings"("enterpriseId");

-- CreateIndex
CREATE UNIQUE INDEX "AccompanyingGuest_reservationId_profileId_key" ON "AccompanyingGuest"("reservationId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ERegistrationLink_tokenHash_key" ON "ERegistrationLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ERegistrationLink_reservationId_idx" ON "ERegistrationLink"("reservationId");

-- CreateIndex
CREATE INDEX "ERegistrationLink_groupBlockId_idx" ON "ERegistrationLink"("groupBlockId");

-- CreateIndex
CREATE UNIQUE INDEX "ERegistrationGuestSlot_reservationId_slotIndex_key" ON "ERegistrationGuestSlot"("reservationId", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "RoomAttendant_userId_key" ON "RoomAttendant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupBlock_propertyId_code_key" ON "GroupBlock"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "GroupBlockRoom_groupBlockId_roomTypeId_key" ON "GroupBlockRoom"("groupBlockId", "roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyNightAuditLog_propertyId_auditDate_key" ON "PropertyNightAuditLog"("propertyId", "auditDate");

-- CreateIndex
CREATE UNIQUE INDEX "EodRun_propertyId_businessDate_key" ON "EodRun"("propertyId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "PropertySequence_propertyId_sequenceType_key" ON "PropertySequence"("propertyId", "sequenceType");

-- CreateIndex
CREATE UNIQUE INDEX "GuestRegistration_propertyId_year_registrationNo_key" ON "GuestRegistration"("propertyId", "year", "registrationNo");

-- CreateIndex
CREATE UNIQUE INDEX "GuestRegistration_reservationId_profileId_key" ON "GuestRegistration"("reservationId", "profileId");

-- CreateIndex
CREATE UNIQUE INDEX "EodReport_propertyId_businessDate_reportType_key" ON "EodReport"("propertyId", "businessDate", "reportType");

-- CreateIndex
CREATE INDEX "UserActivityLog_enterpriseId_createdAt_idx" ON "UserActivityLog"("enterpriseId", "createdAt");

-- CreateIndex
CREATE INDEX "UserActivityLog_userId_createdAt_idx" ON "UserActivityLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_propertyId_code_key" ON "Allocation"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlanAllocation_ratePlanId_allocationId_key" ON "RatePlanAllocation"("ratePlanId", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "RatePlanAgentAccess_ratePlanId_upid_key" ON "RatePlanAgentAccess"("ratePlanId", "upid");

-- CreateIndex
CREATE UNIQUE INDEX "MealPlanAllocation_mealPlanId_allocationId_key" ON "MealPlanAllocation"("mealPlanId", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReservationAllocation_reservationId_allocationId_key" ON "ReservationAllocation"("reservationId", "allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "EnterpriseAddonAccess_enterpriseId_module_key" ON "EnterpriseAddonAccess"("enterpriseId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "ExcursionType_propertyId_code_key" ON "ExcursionType"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ExcursionDeparture_excursionTypeId_departureDate_departureT_key" ON "ExcursionDeparture"("excursionTypeId", "departureDate", "departureTime");

-- CreateIndex
CREATE UNIQUE INDEX "ExcursionBooking_folioLineItemId_key" ON "ExcursionBooking"("folioLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ExcursionBooking_movedToBookingId_key" ON "ExcursionBooking"("movedToBookingId");

-- CreateIndex
CREATE INDEX "ExcursionBooking_departureId_idx" ON "ExcursionBooking"("departureId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaTreatmentCategory_propertyId_name_key" ON "SpaTreatmentCategory"("propertyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SpaTherapist_userId_key" ON "SpaTherapist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaTherapistTreatment_therapistId_treatmentId_key" ON "SpaTherapistTreatment"("therapistId", "treatmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaTreatmentRoom_treatmentId_roomId_key" ON "SpaTreatmentRoom"("treatmentId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaAppointment_folioLineItemId_key" ON "SpaAppointment"("folioLineItemId");

-- CreateIndex
CREATE INDEX "SpaAppointment_propertyId_appointmentDate_idx" ON "SpaAppointment"("propertyId", "appointmentDate");

-- CreateIndex
CREATE INDEX "SpaAppointment_roomId_appointmentDate_idx" ON "SpaAppointment"("roomId", "appointmentDate");

-- CreateIndex
CREATE INDEX "SpaAppointmentParticipant_therapistId_idx" ON "SpaAppointmentParticipant"("therapistId");

-- CreateIndex
CREATE INDEX "SpaAppointmentParticipant_appointmentId_idx" ON "SpaAppointmentParticipant"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaGuestTherapistPreference_profileId_propertyId_key" ON "SpaGuestTherapistPreference"("profileId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_webhookToken_key" ON "ChannelConnection"("webhookToken");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_enterpriseId_name_key" ON "ChannelConnection"("enterpriseId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPropertyLink_propertyId_key" ON "ChannelPropertyLink"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPropertyLink_connectionId_externalPropertyId_key" ON "ChannelPropertyLink"("connectionId", "externalPropertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomTypeMap_roomTypeId_key" ON "ChannelRoomTypeMap"("roomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomTypeMap_linkId_externalRoomId_key" ON "ChannelRoomTypeMap"("linkId", "externalRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRatePlanMap_ratePlanId_key" ON "ChannelRatePlanMap"("ratePlanId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRatePlanMap_linkId_externalRateId_key" ON "ChannelRatePlanMap"("linkId", "externalRateId");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_enterpriseId_createdAt_idx" ON "ChannelSyncLog"("enterpriseId", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_connectionId_createdAt_idx" ON "ChannelSyncLog"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_enterpriseId_startedAt_idx" ON "JobRun"("enterpriseId", "startedAt");

-- CreateIndex
CREATE INDEX "ChannelInboundBooking_enterpriseId_receivedAt_idx" ON "ChannelInboundBooking"("enterpriseId", "receivedAt");

-- CreateIndex
CREATE INDEX "ChannelInboundBooking_enterpriseId_isOverbooking_idx" ON "ChannelInboundBooking"("enterpriseId", "isOverbooking");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelInboundBooking_connectionId_externalBookingId_key" ON "ChannelInboundBooking"("connectionId", "externalBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelBookingDefaults_linkId_key" ON "ChannelBookingDefaults"("linkId");

-- AddForeignKey
ALTER TABLE "EnterpriseLicense" ADD CONSTRAINT "EnterpriseLicense_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyLicenseAllowance" ADD CONSTRAINT "PropertyLicenseAllowance_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseInvoice" ADD CONSTRAINT "LicenseInvoice_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessGrant" ADD CONSTRAINT "SupportAccessGrant_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemCode" ADD CONSTRAINT "SystemCode_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NightAuditLog" ADD CONSTRAINT "NightAuditLog_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomType" ADD CONSTRAINT "RoomType_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomTypeFeature" ADD CONSTRAINT "RoomTypeFeature_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_assignedAttendantId_fkey" FOREIGN KEY ("assignedAttendantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomFeature" ADD CONSTRAINT "RoomFeature_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeGroup" ADD CONSTRAINT "ChargeGroup_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSubgroup" ADD CONSTRAINT "ChargeSubgroup_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSubgroup" ADD CONSTRAINT "ChargeSubgroup_chargeGroupId_fkey" FOREIGN KEY ("chargeGroupId") REFERENCES "ChargeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeSubgroup" ADD CONSTRAINT "ChargeSubgroup_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeCode" ADD CONSTRAINT "ChargeCode_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeCode" ADD CONSTRAINT "ChargeCode_chargeSubgroupId_fkey" FOREIGN KEY ("chargeSubgroupId") REFERENCES "ChargeSubgroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeCode" ADD CONSTRAINT "ChargeCode_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeCodeGenerate" ADD CONSTRAINT "ChargeCodeGenerate_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeCodeGenerate" ADD CONSTRAINT "ChargeCodeGenerate_generatorCodeId_fkey" FOREIGN KEY ("generatorCodeId") REFERENCES "ChargeCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeCodeGenerate" ADD CONSTRAINT "ChargeCodeGenerate_generatedCodeId_fkey" FOREIGN KEY ("generatedCodeId") REFERENCES "ChargeCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_originPropertyId_fkey" FOREIGN KEY ("originPropertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileCommunication" ADD CONSTRAINT "ProfileCommunication_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileAddress" ADD CONSTRAINT "ProfileAddress_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileAttachment" ADD CONSTRAINT "ProfileAttachment_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePreference" ADD CONSTRAINT "ProfilePreference_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileDocument" ADD CONSTRAINT "ProfileDocument_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileNote" ADD CONSTRAINT "ProfileNote_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlan" ADD CONSTRAINT "RatePlan_parentRatePlanId_fkey" FOREIGN KEY ("parentRatePlanId") REFERENCES "RatePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceCalendar" ADD CONSTRAINT "PriceCalendar_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceCalendar" ADD CONSTRAINT "PriceCalendar_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRestriction" ADD CONSTRAINT "AvailabilityRestriction_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRestriction" ADD CONSTRAINT "AvailabilityRestriction_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_primaryGuestId_fkey" FOREIGN KEY ("primaryGuestId") REFERENCES "Profile"("upid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_travelAgentId_fkey" FOREIGN KEY ("travelAgentId") REFERENCES "Profile"("upid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationTransport" ADD CONSTRAINT "ReservationTransport_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationSpecialRequest" ADD CONSTRAINT "ReservationSpecialRequest_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_payeeProfileId_fkey" FOREIGN KEY ("payeeProfileId") REFERENCES "Profile"("upid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioLineItem" ADD CONSTRAINT "FolioLineItem_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioLineItem" ADD CONSTRAINT "FolioLineItem_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioLineItem" ADD CONSTRAINT "FolioLineItem_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioLineItem" ADD CONSTRAINT "FolioLineItem_outletCheckId_fkey" FOREIGN KEY ("outletCheckId") REFERENCES "OutletCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioLineItem" ADD CONSTRAINT "FolioLineItem_roomAssignmentId_fkey" FOREIGN KEY ("roomAssignmentId") REFERENCES "RoomAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioLineItem" ADD CONSTRAINT "FolioLineItem_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioLineItem" ADD CONSTRAINT "FolioLineItem_generatedFromLineItemId_fkey" FOREIGN KEY ("generatedFromLineItemId") REFERENCES "FolioLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioRoutingRule" ADD CONSTRAINT "FolioRoutingRule_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioRoutingRule" ADD CONSTRAINT "FolioRoutingRule_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioRoutingRule" ADD CONSTRAINT "FolioRoutingRule_targetFolioId_fkey" FOREIGN KEY ("targetFolioId") REFERENCES "Folio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierShift" ADD CONSTRAINT "CashierShift_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierPaidOut" ADD CONSTRAINT "CashierPaidOut_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyFeeRule" ADD CONSTRAINT "PropertyFeeRule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyFeeRule" ADD CONSTRAINT "PropertyFeeRule_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyExchange" ADD CONSTRAINT "CurrencyExchange_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyExchange" ADD CONSTRAINT "CurrencyExchange_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyExchange" ADD CONSTRAINT "CurrencyExchange_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletChargeCode" ADD CONSTRAINT "OutletChargeCode_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletChargeCode" ADD CONSTRAINT "OutletChargeCode_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletCheck" ADD CONSTRAINT "OutletCheck_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletCheck" ADD CONSTRAINT "OutletCheck_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletCheck" ADD CONSTRAINT "OutletCheck_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnterpriseSettings" ADD CONSTRAINT "EnterpriseSettings_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnterpriseSettings" ADD CONSTRAINT "EnterpriseSettings_spaOutletId_fkey" FOREIGN KEY ("spaOutletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnterpriseSettings" ADD CONSTRAINT "EnterpriseSettings_excursionOutletId_fkey" FOREIGN KEY ("excursionOutletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationTrace" ADD CONSTRAINT "ReservationTrace_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMaintenance" ADD CONSTRAINT "RoomMaintenance_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMaintenance" ADD CONSTRAINT "RoomMaintenance_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccompanyingGuest" ADD CONSTRAINT "AccompanyingGuest_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccompanyingGuest" ADD CONSTRAINT "AccompanyingGuest_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ERegistrationLink" ADD CONSTRAINT "ERegistrationLink_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ERegistrationLink" ADD CONSTRAINT "ERegistrationLink_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ERegistrationLink" ADD CONSTRAINT "ERegistrationLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ERegistrationLink" ADD CONSTRAINT "ERegistrationLink_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ERegistrationGuestSlot" ADD CONSTRAINT "ERegistrationGuestSlot_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ERegistrationLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ERegistrationGuestSlot" ADD CONSTRAINT "ERegistrationGuestSlot_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ERegistrationGuestSlot" ADD CONSTRAINT "ERegistrationGuestSlot_existingProfileId_fkey" FOREIGN KEY ("existingProfileId") REFERENCES "Profile"("upid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAssignment" ADD CONSTRAINT "RoomAssignment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAssignment" ADD CONSTRAINT "RoomAssignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAssignment" ADD CONSTRAINT "RoomAssignment_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAssignment" ADD CONSTRAINT "RoomAssignment_chargeRoomTypeId_fkey" FOREIGN KEY ("chargeRoomTypeId") REFERENCES "RoomType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAssignment" ADD CONSTRAINT "RoomAssignment_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "RoomAttendant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAttendant" ADD CONSTRAINT "RoomAttendant_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAttendant" ADD CONSTRAINT "RoomAttendant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBlock" ADD CONSTRAINT "GroupBlock_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBlock" ADD CONSTRAINT "GroupBlock_payeeProfileId_fkey" FOREIGN KEY ("payeeProfileId") REFERENCES "Profile"("upid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBlockRoom" ADD CONSTRAINT "GroupBlockRoom_groupBlockId_fkey" FOREIGN KEY ("groupBlockId") REFERENCES "GroupBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBlockRoom" ADD CONSTRAINT "GroupBlockRoom_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyNightAuditLog" ADD CONSTRAINT "PropertyNightAuditLog_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EodRun" ADD CONSTRAINT "EodRun_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertySequence" ADD CONSTRAINT "PropertySequence_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRegistration" ADD CONSTRAINT "GuestRegistration_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRegistration" ADD CONSTRAINT "GuestRegistration_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestRegistration" ADD CONSTRAINT "GuestRegistration_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EodReport" ADD CONSTRAINT "EodReport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationRate" ADD CONSTRAINT "AllocationRate_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlanAllocation" ADD CONSTRAINT "RatePlanAllocation_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlanAllocation" ADD CONSTRAINT "RatePlanAllocation_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlanAgentAccess" ADD CONSTRAINT "RatePlanAgentAccess_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatePlanAgentAccess" ADD CONSTRAINT "RatePlanAgentAccess_upid_fkey" FOREIGN KEY ("upid") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanAllocation" ADD CONSTRAINT "MealPlanAllocation_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanAllocation" ADD CONSTRAINT "MealPlanAllocation_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationAllocation" ADD CONSTRAINT "ReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationAllocation" ADD CONSTRAINT "ReservationAllocation_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnterpriseAddonAccess" ADD CONSTRAINT "EnterpriseAddonAccess_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionType" ADD CONSTRAINT "ExcursionType_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionType" ADD CONSTRAINT "ExcursionType_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionRate" ADD CONSTRAINT "ExcursionRate_excursionTypeId_fkey" FOREIGN KEY ("excursionTypeId") REFERENCES "ExcursionType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionSchedule" ADD CONSTRAINT "ExcursionSchedule_excursionTypeId_fkey" FOREIGN KEY ("excursionTypeId") REFERENCES "ExcursionType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionDeparture" ADD CONSTRAINT "ExcursionDeparture_excursionTypeId_fkey" FOREIGN KEY ("excursionTypeId") REFERENCES "ExcursionType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionDeparture" ADD CONSTRAINT "ExcursionDeparture_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ExcursionSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionBooking" ADD CONSTRAINT "ExcursionBooking_departureId_fkey" FOREIGN KEY ("departureId") REFERENCES "ExcursionDeparture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionBooking" ADD CONSTRAINT "ExcursionBooking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionBooking" ADD CONSTRAINT "ExcursionBooking_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionBooking" ADD CONSTRAINT "ExcursionBooking_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionBooking" ADD CONSTRAINT "ExcursionBooking_folioLineItemId_fkey" FOREIGN KEY ("folioLineItemId") REFERENCES "FolioLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionBooking" ADD CONSTRAINT "ExcursionBooking_refundPaymentId_fkey" FOREIGN KEY ("refundPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExcursionBooking" ADD CONSTRAINT "ExcursionBooking_movedFromDepartureId_fkey" FOREIGN KEY ("movedFromDepartureId") REFERENCES "ExcursionDeparture"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTreatmentCategory" ADD CONSTRAINT "SpaTreatmentCategory_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTreatment" ADD CONSTRAINT "SpaTreatment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTreatment" ADD CONSTRAINT "SpaTreatment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SpaTreatmentCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTreatment" ADD CONSTRAINT "SpaTreatment_chargeCodeId_fkey" FOREIGN KEY ("chargeCodeId") REFERENCES "ChargeCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTreatmentRate" ADD CONSTRAINT "SpaTreatmentRate_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "SpaTreatment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTherapist" ADD CONSTRAINT "SpaTherapist_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTherapist" ADD CONSTRAINT "SpaTherapist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTherapistTreatment" ADD CONSTRAINT "SpaTherapistTreatment_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTherapistTreatment" ADD CONSTRAINT "SpaTherapistTreatment_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "SpaTreatment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaRoom" ADD CONSTRAINT "SpaRoom_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTreatmentRoom" ADD CONSTRAINT "SpaTreatmentRoom_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "SpaTreatment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTreatmentRoom" ADD CONSTRAINT "SpaTreatmentRoom_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SpaRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTherapistSchedule" ADD CONSTRAINT "SpaTherapistSchedule_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaTherapistAvailabilityException" ADD CONSTRAINT "SpaTherapistAvailabilityException_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaRoomAvailabilityException" ADD CONSTRAINT "SpaRoomAvailabilityException_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SpaRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaSettings" ADD CONSTRAINT "SpaSettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "SpaTreatment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "SpaRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "Folio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_folioLineItemId_fkey" FOREIGN KEY ("folioLineItemId") REFERENCES "FolioLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointment" ADD CONSTRAINT "SpaAppointment_refundPaymentId_fkey" FOREIGN KEY ("refundPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointmentParticipant" ADD CONSTRAINT "SpaAppointmentParticipant_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "SpaAppointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointmentParticipant" ADD CONSTRAINT "SpaAppointmentParticipant_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointmentParticipant" ADD CONSTRAINT "SpaAppointmentParticipant_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaAppointmentParticipant" ADD CONSTRAINT "SpaAppointmentParticipant_requestedTherapistId_fkey" FOREIGN KEY ("requestedTherapistId") REFERENCES "SpaTherapist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaGuestTherapistPreference" ADD CONSTRAINT "SpaGuestTherapistPreference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("upid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaGuestTherapistPreference" ADD CONSTRAINT "SpaGuestTherapistPreference_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaGuestTherapistPreference" ADD CONSTRAINT "SpaGuestTherapistPreference_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "SpaTherapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPropertyLink" ADD CONSTRAINT "ChannelPropertyLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPropertyLink" ADD CONSTRAINT "ChannelPropertyLink_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoomTypeMap" ADD CONSTRAINT "ChannelRoomTypeMap_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ChannelPropertyLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoomTypeMap" ADD CONSTRAINT "ChannelRoomTypeMap_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRatePlanMap" ADD CONSTRAINT "ChannelRatePlanMap_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ChannelPropertyLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRatePlanMap" ADD CONSTRAINT "ChannelRatePlanMap_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSyncLog" ADD CONSTRAINT "ChannelSyncLog_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSyncLog" ADD CONSTRAINT "ChannelSyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelInboundBooking" ADD CONSTRAINT "ChannelInboundBooking_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "Enterprise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelInboundBooking" ADD CONSTRAINT "ChannelInboundBooking_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelInboundBooking" ADD CONSTRAINT "ChannelInboundBooking_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelInboundBooking" ADD CONSTRAINT "ChannelInboundBooking_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelInboundBooking" ADD CONSTRAINT "ChannelInboundBooking_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBookingDefaults" ADD CONSTRAINT "ChannelBookingDefaults_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ChannelPropertyLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBookingDefaults" ADD CONSTRAINT "ChannelBookingDefaults_ratePlanId_fkey" FOREIGN KEY ("ratePlanId") REFERENCES "RatePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- PARTIAL UNIQUE INDEXES
--
-- Prisma's schema language cannot express an index with a WHERE clause, so these are
-- written by hand. They were carried over from the pre-2026-08-02 SQLite migrations
-- (20260725150000_cashier_shift_one_open, 20260727160000_job_run) when that history was
-- squashed into this baseline: `prisma migrate diff --to-schema-datamodel` only emits
-- what the schema itself declares, so anything hand-written has to be re-added here.
--
-- These are NOT optimisations. Each one is a concurrency guard that the application
-- relies on for correctness, and both models carry a NOTE in schema.prisma pointing here.
-- ============================================================================

-- At most one RUNNING JobRun per (job, enterprise). This is what makes overlapping cron
-- invocations safe: the second INSERT violates this index, is caught as P2002, and the
-- run is reported SKIPPED_LOCKED instead of executing the same job twice concurrently
-- (src/lib/jobs/runner.ts). Without it, a slow night-audit job could double-post charges.
CREATE UNIQUE INDEX "JobRun_one_running_per_job_enterprise"
  ON "JobRun"("jobName", "enterpriseId")
  WHERE "status" = 'RUNNING';

-- At most one OPEN cash shift per (user, property). Guards cash reconciliation: two
-- concurrently open shifts for one cashier would split their takings across both.
CREATE UNIQUE INDEX "CashierShift_one_open_per_user_property"
  ON "CashierShift"("userId", "propertyId")
  WHERE "closedAt" IS NULL;
