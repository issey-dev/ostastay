-- Index every foreign-key column that lacked one.
--
-- PostgreSQL does NOT create an index for a foreign key constraint. (MySQL does, which is
-- where the common assumption comes from, and SQLite's planner hid the cost on the small
-- local databases this app used before 2026-08-02.) An audit of the live schema found 122
-- of 200 foreign keys with no index whose leading column was the FK column.
--
-- Two distinct costs were being paid:
--
--   1. Reads. Every join or filter on the column was a sequential scan. This included the
--      hottest paths in the product: Reservation.propertyId (the filter on essentially
--      every front-office screen), FolioLineItem.folioId (opening any folio),
--      Payment.folioId (computing a balance), and every tenant-scoping *.enterpriseId.
--
--   2. Deletes. 51 of them are ON DELETE CASCADE. Deleting one parent row makes Postgres
--      find the referencing rows in each child table; with no index that is a full scan of
--      the child, per parent row deleted. Removing an Enterprise or a Property would have
--      scanned dozens of tables.
--
-- Written as plain CREATE INDEX rather than CREATE INDEX CONCURRENTLY: Prisma runs each
-- migration inside a transaction and CONCURRENTLY cannot run in one. Plain CREATE INDEX
-- takes an ACCESS EXCLUSIVE lock for the duration, which is why this is being applied now,
-- while the tables are effectively empty and each statement completes in milliseconds.
-- ANY FUTURE index added to a table that already holds real data should be created
-- manually with CONCURRENTLY, outside the migration, or it will lock out the front desk.

-- CreateIndex
CREATE INDEX "AccompanyingGuest_profileId_idx" ON "AccompanyingGuest"("profileId");

-- CreateIndex
CREATE INDEX "Allocation_chargeCodeId_idx" ON "Allocation"("chargeCodeId");

-- CreateIndex
CREATE INDEX "AllocationRate_allocationId_idx" ON "AllocationRate"("allocationId");

-- CreateIndex
CREATE INDEX "AvailabilityRestriction_roomTypeId_idx" ON "AvailabilityRestriction"("roomTypeId");

-- CreateIndex
CREATE INDEX "Building_propertyId_idx" ON "Building"("propertyId");

-- CreateIndex
CREATE INDEX "CashierPaidOut_shiftId_idx" ON "CashierPaidOut"("shiftId");

-- CreateIndex
CREATE INDEX "CashierShift_enterpriseId_idx" ON "CashierShift"("enterpriseId");

-- CreateIndex
CREATE INDEX "ChannelBookingDefaults_ratePlanId_idx" ON "ChannelBookingDefaults"("ratePlanId");

-- CreateIndex
CREATE INDEX "ChannelInboundBooking_propertyId_idx" ON "ChannelInboundBooking"("propertyId");

-- CreateIndex
CREATE INDEX "ChannelInboundBooking_reservationId_idx" ON "ChannelInboundBooking"("reservationId");

-- CreateIndex
CREATE INDEX "ChannelInboundBooking_roomTypeId_idx" ON "ChannelInboundBooking"("roomTypeId");

-- CreateIndex
CREATE INDEX "ChargeCode_chargeSubgroupId_idx" ON "ChargeCode"("chargeSubgroupId");

-- CreateIndex
CREATE INDEX "ChargeCode_taxProfileId_idx" ON "ChargeCode"("taxProfileId");

-- CreateIndex
CREATE INDEX "ChargeCodeGenerate_generatedCodeId_idx" ON "ChargeCodeGenerate"("generatedCodeId");

-- CreateIndex
CREATE INDEX "ChargeSubgroup_chargeGroupId_idx" ON "ChargeSubgroup"("chargeGroupId");

-- CreateIndex
CREATE INDEX "ChargeSubgroup_outletId_idx" ON "ChargeSubgroup"("outletId");

-- CreateIndex
CREATE INDEX "CurrencyExchange_createdByUserId_idx" ON "CurrencyExchange"("createdByUserId");

-- CreateIndex
CREATE INDEX "CurrencyExchange_propertyId_idx" ON "CurrencyExchange"("propertyId");

-- CreateIndex
CREATE INDEX "CurrencyExchange_shiftId_idx" ON "CurrencyExchange"("shiftId");

-- CreateIndex
CREATE INDEX "ERegistrationGuestSlot_existingProfileId_idx" ON "ERegistrationGuestSlot"("existingProfileId");

-- CreateIndex
CREATE INDEX "ERegistrationGuestSlot_linkId_idx" ON "ERegistrationGuestSlot"("linkId");

-- CreateIndex
CREATE INDEX "ERegistrationLink_enterpriseId_idx" ON "ERegistrationLink"("enterpriseId");

-- CreateIndex
CREATE INDEX "ERegistrationLink_propertyId_idx" ON "ERegistrationLink"("propertyId");

-- CreateIndex
CREATE INDEX "EnterpriseSettings_excursionOutletId_idx" ON "EnterpriseSettings"("excursionOutletId");

-- CreateIndex
CREATE INDEX "EnterpriseSettings_spaOutletId_idx" ON "EnterpriseSettings"("spaOutletId");

-- CreateIndex
CREATE INDEX "ExcursionBooking_folioId_idx" ON "ExcursionBooking"("folioId");

-- CreateIndex
CREATE INDEX "ExcursionBooking_movedFromDepartureId_idx" ON "ExcursionBooking"("movedFromDepartureId");

-- CreateIndex
CREATE INDEX "ExcursionBooking_propertyId_idx" ON "ExcursionBooking"("propertyId");

-- CreateIndex
CREATE INDEX "ExcursionBooking_refundPaymentId_idx" ON "ExcursionBooking"("refundPaymentId");

-- CreateIndex
CREATE INDEX "ExcursionBooking_reservationId_idx" ON "ExcursionBooking"("reservationId");

-- CreateIndex
CREATE INDEX "ExcursionDeparture_scheduleId_idx" ON "ExcursionDeparture"("scheduleId");

-- CreateIndex
CREATE INDEX "ExcursionRate_excursionTypeId_idx" ON "ExcursionRate"("excursionTypeId");

-- CreateIndex
CREATE INDEX "ExcursionSchedule_excursionTypeId_idx" ON "ExcursionSchedule"("excursionTypeId");

-- CreateIndex
CREATE INDEX "ExcursionType_chargeCodeId_idx" ON "ExcursionType"("chargeCodeId");

-- CreateIndex
CREATE INDEX "Facility_propertyId_idx" ON "Facility"("propertyId");

-- CreateIndex
CREATE INDEX "Floor_buildingId_idx" ON "Floor"("buildingId");

-- CreateIndex
CREATE INDEX "Folio_groupBlockId_idx" ON "Folio"("groupBlockId");

-- CreateIndex
CREATE INDEX "Folio_payeeProfileId_idx" ON "Folio"("payeeProfileId");

-- CreateIndex
CREATE INDEX "Folio_reservationId_idx" ON "Folio"("reservationId");

-- CreateIndex
CREATE INDEX "FolioLineItem_chargeCodeId_idx" ON "FolioLineItem"("chargeCodeId");

-- CreateIndex
CREATE INDEX "FolioLineItem_folioId_idx" ON "FolioLineItem"("folioId");

-- CreateIndex
CREATE INDEX "FolioLineItem_generatedFromLineItemId_idx" ON "FolioLineItem"("generatedFromLineItemId");

-- CreateIndex
CREATE INDEX "FolioLineItem_outletCheckId_idx" ON "FolioLineItem"("outletCheckId");

-- CreateIndex
CREATE INDEX "FolioLineItem_outletId_idx" ON "FolioLineItem"("outletId");

-- CreateIndex
CREATE INDEX "FolioLineItem_roomAssignmentId_idx" ON "FolioLineItem"("roomAssignmentId");

-- CreateIndex
CREATE INDEX "FolioLineItem_shiftId_idx" ON "FolioLineItem"("shiftId");

-- CreateIndex
CREATE INDEX "FolioRoutingRule_chargeCodeId_idx" ON "FolioRoutingRule"("chargeCodeId");

-- CreateIndex
CREATE INDEX "FolioRoutingRule_targetFolioId_idx" ON "FolioRoutingRule"("targetFolioId");

-- CreateIndex
CREATE INDEX "GroupBlock_payeeProfileId_idx" ON "GroupBlock"("payeeProfileId");

-- CreateIndex
CREATE INDEX "GroupBlockRoom_roomTypeId_idx" ON "GroupBlockRoom"("roomTypeId");

-- CreateIndex
CREATE INDEX "GuestRegistration_profileId_idx" ON "GuestRegistration"("profileId");

-- CreateIndex
CREATE INDEX "HousekeepingTask_assignedToId_idx" ON "HousekeepingTask"("assignedToId");

-- CreateIndex
CREATE INDEX "HousekeepingTask_roomId_idx" ON "HousekeepingTask"("roomId");

-- CreateIndex
CREATE INDEX "MealPlanAllocation_allocationId_idx" ON "MealPlanAllocation"("allocationId");

-- CreateIndex
CREATE INDEX "NightAuditLog_enterpriseId_idx" ON "NightAuditLog"("enterpriseId");

-- CreateIndex
CREATE INDEX "Outlet_taxProfileId_idx" ON "Outlet"("taxProfileId");

-- CreateIndex
CREATE INDEX "OutletChargeCode_chargeCodeId_idx" ON "OutletChargeCode"("chargeCodeId");

-- CreateIndex
CREATE INDEX "Payment_chargeCodeId_idx" ON "Payment"("chargeCodeId");

-- CreateIndex
CREATE INDEX "Payment_folioId_idx" ON "Payment"("folioId");

-- CreateIndex
CREATE INDEX "Payment_paymentMethodId_idx" ON "Payment"("paymentMethodId");

-- CreateIndex
CREATE INDEX "Payment_shiftId_idx" ON "Payment"("shiftId");

-- CreateIndex
CREATE INDEX "PaymentMethod_chargeCodeId_idx" ON "PaymentMethod"("chargeCodeId");

-- CreateIndex
CREATE INDEX "PaymentMethod_enterpriseId_idx" ON "PaymentMethod"("enterpriseId");

-- CreateIndex
CREATE INDEX "PriceCalendar_roomTypeId_idx" ON "PriceCalendar"("roomTypeId");

-- CreateIndex
CREATE INDEX "Profile_enterpriseId_idx" ON "Profile"("enterpriseId");

-- CreateIndex
CREATE INDEX "Profile_originPropertyId_idx" ON "Profile"("originPropertyId");

-- CreateIndex
CREATE INDEX "ProfileAddress_upid_idx" ON "ProfileAddress"("upid");

-- CreateIndex
CREATE INDEX "ProfileAttachment_upid_idx" ON "ProfileAttachment"("upid");

-- CreateIndex
CREATE INDEX "ProfileCommunication_upid_idx" ON "ProfileCommunication"("upid");

-- CreateIndex
CREATE INDEX "ProfileNote_upid_idx" ON "ProfileNote"("upid");

-- CreateIndex
CREATE INDEX "ProfilePreference_upid_idx" ON "ProfilePreference"("upid");

-- CreateIndex
CREATE INDEX "Property_enterpriseId_idx" ON "Property"("enterpriseId");

-- CreateIndex
CREATE INDEX "Property_reviewedByUserId_idx" ON "Property"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "PropertyFeeRule_chargeCodeId_idx" ON "PropertyFeeRule"("chargeCodeId");

-- CreateIndex
CREATE INDEX "RatePlan_chargeCodeId_idx" ON "RatePlan"("chargeCodeId");

-- CreateIndex
CREATE INDEX "RatePlan_parentRatePlanId_idx" ON "RatePlan"("parentRatePlanId");

-- CreateIndex
CREATE INDEX "RatePlanAgentAccess_upid_idx" ON "RatePlanAgentAccess"("upid");

-- CreateIndex
CREATE INDEX "RatePlanAllocation_allocationId_idx" ON "RatePlanAllocation"("allocationId");

-- CreateIndex
CREATE INDEX "Reservation_groupBlockId_idx" ON "Reservation"("groupBlockId");

-- CreateIndex
CREATE INDEX "Reservation_primaryGuestId_idx" ON "Reservation"("primaryGuestId");

-- CreateIndex
CREATE INDEX "Reservation_propertyId_idx" ON "Reservation"("propertyId");

-- CreateIndex
CREATE INDEX "Reservation_travelAgentId_idx" ON "Reservation"("travelAgentId");

-- CreateIndex
CREATE INDEX "ReservationAllocation_allocationId_idx" ON "ReservationAllocation"("allocationId");

-- CreateIndex
CREATE INDEX "ReservationTrace_reservationId_idx" ON "ReservationTrace"("reservationId");

-- CreateIndex
CREATE INDEX "Room_assignedAttendantId_idx" ON "Room"("assignedAttendantId");

-- CreateIndex
CREATE INDEX "Room_floorId_idx" ON "Room"("floorId");

-- CreateIndex
CREATE INDEX "Room_roomTypeId_idx" ON "Room"("roomTypeId");

-- CreateIndex
CREATE INDEX "RoomAssignment_chargeRoomTypeId_idx" ON "RoomAssignment"("chargeRoomTypeId");

-- CreateIndex
CREATE INDEX "RoomAssignment_ratePlanId_idx" ON "RoomAssignment"("ratePlanId");

-- CreateIndex
CREATE INDEX "RoomAssignment_reservationId_idx" ON "RoomAssignment"("reservationId");

-- CreateIndex
CREATE INDEX "RoomAssignment_roomId_idx" ON "RoomAssignment"("roomId");

-- CreateIndex
CREATE INDEX "RoomAssignment_roomTypeId_idx" ON "RoomAssignment"("roomTypeId");

-- CreateIndex
CREATE INDEX "RoomAttendant_enterpriseId_idx" ON "RoomAttendant"("enterpriseId");

-- CreateIndex
CREATE INDEX "RoomMaintenance_assignedToId_idx" ON "RoomMaintenance"("assignedToId");

-- CreateIndex
CREATE INDEX "RoomMaintenance_roomId_idx" ON "RoomMaintenance"("roomId");

-- CreateIndex
CREATE INDEX "RoomType_propertyId_idx" ON "RoomType"("propertyId");

-- CreateIndex
CREATE INDEX "SpaAppointment_folioId_idx" ON "SpaAppointment"("folioId");

-- CreateIndex
CREATE INDEX "SpaAppointment_refundPaymentId_idx" ON "SpaAppointment"("refundPaymentId");

-- CreateIndex
CREATE INDEX "SpaAppointment_treatmentId_idx" ON "SpaAppointment"("treatmentId");

-- CreateIndex
CREATE INDEX "SpaAppointmentParticipant_requestedTherapistId_idx" ON "SpaAppointmentParticipant"("requestedTherapistId");

-- CreateIndex
CREATE INDEX "SpaAppointmentParticipant_reservationId_idx" ON "SpaAppointmentParticipant"("reservationId");

-- CreateIndex
CREATE INDEX "SpaGuestTherapistPreference_propertyId_idx" ON "SpaGuestTherapistPreference"("propertyId");

-- CreateIndex
CREATE INDEX "SpaGuestTherapistPreference_therapistId_idx" ON "SpaGuestTherapistPreference"("therapistId");

-- CreateIndex
CREATE INDEX "SpaRoom_propertyId_idx" ON "SpaRoom"("propertyId");

-- CreateIndex
CREATE INDEX "SpaRoomAvailabilityException_roomId_idx" ON "SpaRoomAvailabilityException"("roomId");

-- CreateIndex
CREATE INDEX "SpaTherapist_propertyId_idx" ON "SpaTherapist"("propertyId");

-- CreateIndex
CREATE INDEX "SpaTherapistAvailabilityException_therapistId_idx" ON "SpaTherapistAvailabilityException"("therapistId");

-- CreateIndex
CREATE INDEX "SpaTherapistSchedule_therapistId_idx" ON "SpaTherapistSchedule"("therapistId");

-- CreateIndex
CREATE INDEX "SpaTherapistTreatment_treatmentId_idx" ON "SpaTherapistTreatment"("treatmentId");

-- CreateIndex
CREATE INDEX "SpaTreatment_categoryId_idx" ON "SpaTreatment"("categoryId");

-- CreateIndex
CREATE INDEX "SpaTreatment_chargeCodeId_idx" ON "SpaTreatment"("chargeCodeId");

-- CreateIndex
CREATE INDEX "SpaTreatment_propertyId_idx" ON "SpaTreatment"("propertyId");

-- CreateIndex
CREATE INDEX "SpaTreatmentRate_treatmentId_idx" ON "SpaTreatmentRate"("treatmentId");

-- CreateIndex
CREATE INDEX "SpaTreatmentRoom_roomId_idx" ON "SpaTreatmentRoom"("roomId");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_approvedByUserId_idx" ON "SupportAccessGrant"("approvedByUserId");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_enterpriseId_idx" ON "SupportAccessGrant"("enterpriseId");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_requestedByUserId_idx" ON "SupportAccessGrant"("requestedByUserId");

-- CreateIndex
CREATE INDEX "TaxProfile_enterpriseId_idx" ON "TaxProfile"("enterpriseId");

-- CreateIndex
CREATE INDEX "TaxRate_taxProfileId_idx" ON "TaxRate"("taxProfileId");

-- CreateIndex
CREATE INDEX "User_enterpriseId_idx" ON "User"("enterpriseId");

-- CreateIndex
CREATE INDEX "User_propertyId_idx" ON "User"("propertyId");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

