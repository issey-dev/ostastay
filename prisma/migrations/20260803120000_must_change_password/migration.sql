-- Temporary-password enforcement for platform-created handover accounts: while set,
-- login refuses to mint a session and the only path forward is the change-password
-- endpoint, which verifies the temp password, sets the user's own, and clears this.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
