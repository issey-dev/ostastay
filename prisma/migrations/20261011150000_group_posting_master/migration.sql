-- Group blocks get a Posting Master (PM) reservation: its folio is the block's master folio.
ALTER TABLE "Reservation" ADD COLUMN "isPostingMaster" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GroupBlock" ADD COLUMN "postingMasterReservationId" TEXT;
CREATE UNIQUE INDEX "GroupBlock_postingMasterReservationId_key" ON "GroupBlock"("postingMasterReservationId");
