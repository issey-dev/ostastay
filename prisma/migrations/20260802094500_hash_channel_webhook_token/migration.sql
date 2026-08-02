-- ChannelConnection.webhookToken held the inbound webhook's bearer secret in PLAINTEXT.
-- That URL is write-capable — possession of it is authority to POST bookings into a
-- tenant's PMS — so anyone with database read access (a pg_dump, a backup, a support
-- query, a leaked snapshot) held a live, usable webhook URL. It is now stored only as a
-- SHA-256 hash, matching what ERegistrationLink.tokenHash already does for the
-- guest-facing links.
--
-- EXISTING TOKENS ARE DESTROYED, NOT CONVERTED. The plaintext could technically have been
-- hashed in place (sha256(webhookToken) would keep the existing URL working), but that
-- would carry forward a credential which, by the very premise of this change, must be
-- treated as already exposed in every dump taken while the column was readable. Hashing a
-- leaked token does not un-leak it; rotating it does.
--
-- OPERATOR ACTION REQUIRED for any connection that already had a webhook URL: regenerate
-- it in the Hub (Channel Manager → the connection → generate webhook URL) and paste the
-- new URL into the channel manager's webhook settings. Until that is done, inbound
-- webhook deliveries to the old URL return 404 — bookings still arrive via the
-- `channel-booking-poll` job, so nothing is permanently lost in the meantime.
ALTER TABLE "ChannelConnection" DROP COLUMN "webhookToken";

ALTER TABLE "ChannelConnection" ADD COLUMN "webhookTokenHash" TEXT;

CREATE UNIQUE INDEX "ChannelConnection_webhookTokenHash_key" ON "ChannelConnection"("webhookTokenHash");
