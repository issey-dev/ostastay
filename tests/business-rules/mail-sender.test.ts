import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

// The transport is the one thing that must never be real here — everything else (add-on
// lookup, sender choice, EmailLog writes) is exercised for real against the test database.
const transportMock = { deliverSmtp: vi.fn() };
vi.mock("@/lib/mailer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mailer")>("@/lib/mailer");
  return { ...actual, deliverSmtp: (...args: unknown[]) => transportMock.deliverSmtp(...args) };
});

const { prisma } = await import("@/lib/db");
const { encryptSecret } = await import("@/lib/secret-crypto");
const { SmtpNotConfiguredError, PlatformSmtpNotConfiguredError } = await import("@/lib/mailer");
const {
  sendEnterpriseMail,
  sendPlatformMail,
  resolveEnterpriseSender,
  hasPlatformEmailAddon,
  MAIL_KINDS,
  MAIL_SENDER,
  PLATFORM_EMAIL_ADDON,
} = await import("@/lib/mail-sender");

const PLATFORM_ENV = [
  "PLATFORM_SMTP_HOST",
  "PLATFORM_SMTP_USERNAME",
  "PLATFORM_SMTP_PASSWORD",
  "PLATFORM_SMTP_FROM_ADDRESS",
] as const;

function setPlatformEnv() {
  process.env.PLATFORM_SMTP_HOST = "smtp.platform.test";
  process.env.PLATFORM_SMTP_USERNAME = "platform-user";
  process.env.PLATFORM_SMTP_PASSWORD = "platform-pass";
  process.env.PLATFORM_SMTP_FROM_ADDRESS = "noreply@platform.test";
}

function clearPlatformEnv() {
  for (const k of PLATFORM_ENV) delete process.env[k];
}

const TENANT_SMTP = {
  smtpHost: "smtp.hotel.test",
  smtpPort: 587,
  smtpUsername: "hotel",
  smtpFromAddress: "reservations@hotel.test",
  smtpUseTls: true,
};

let withOwnSmtpId: string;
let noSmtpId: string;
let onMailServiceId: string;

async function makeEnterprise(slug: string): Promise<string> {
  const e = await prisma.enterprise.upsert({
    where: { slug },
    update: {},
    create: { name: `Test ${slug}`, slug, type: "STANDARD" },
  });
  return e.id;
}

async function setAddon(enterpriseId: string, enabled: boolean) {
  await prisma.enterpriseAddonAccess.upsert({
    where: { enterpriseId_module: { enterpriseId, module: PLATFORM_EMAIL_ADDON } },
    update: { enabled },
    create: { enterpriseId, module: PLATFORM_EMAIL_ADDON, enabled },
  });
}

describe("mail sender: which SMTP an enterprise sends through, and the billing log", () => {
  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-mail-sender";

    withOwnSmtpId = await makeEnterprise("test-mail-own-smtp");
    noSmtpId = await makeEnterprise("test-mail-no-smtp");
    onMailServiceId = await makeEnterprise("test-mail-service");

    await prisma.enterpriseSettings.upsert({
      where: { enterpriseId: withOwnSmtpId },
      update: { ...TENANT_SMTP, smtpPassword: encryptSecret("hotel-pw") },
      create: {
        enterpriseId: withOwnSmtpId,
        resConfirmPrefix: "",
        resConfirmLength: 6,
        ...TENANT_SMTP,
        smtpPassword: encryptSecret("hotel-pw"),
      },
    });

    await setAddon(onMailServiceId, true);
    await setAddon(noSmtpId, false);
  });

  beforeEach(async () => {
    transportMock.deliverSmtp.mockReset();
    transportMock.deliverSmtp.mockResolvedValue("<msg-id@test>");
    setPlatformEnv();
    await prisma.emailLog.deleteMany({
      where: { enterpriseId: { in: [withOwnSmtpId, noSmtpId, onMailServiceId] } },
    });
  });

  afterEach(() => {
    clearPlatformEnv();
  });

  describe("sender selection", () => {
    it("uses the enterprise's OWN SMTP when it has one", async () => {
      const { sender, smtp } = await resolveEnterpriseSender(withOwnSmtpId);
      expect(sender).toBe(MAIL_SENDER.TENANT);
      expect(smtp.host).toBe("smtp.hotel.test");
      expect(smtp.password).toBe("hotel-pw"); // decrypted at point of use
    });

    // The precedence that matters commercially: buying the mail service must not take
    // sending away from a hotel that has its own domain configured.
    it("keeps using the tenant's own SMTP even when the mail service is also purchased", async () => {
      await setAddon(withOwnSmtpId, true);
      try {
        const { sender } = await resolveEnterpriseSender(withOwnSmtpId);
        expect(sender).toBe(MAIL_SENDER.TENANT);
      } finally {
        await setAddon(withOwnSmtpId, false);
      }
    });

    it("falls back to Uppsolut's SMTP when the enterprise has none and bought the add-on", async () => {
      const { sender, smtp } = await resolveEnterpriseSender(onMailServiceId);
      expect(sender).toBe(MAIL_SENDER.PLATFORM);
      expect(smtp.host).toBe("smtp.platform.test");
    });

    it("refuses when the enterprise has no SMTP and has not bought the add-on", async () => {
      await expect(resolveEnterpriseSender(noSmtpId)).rejects.toThrow(SmtpNotConfiguredError);
    });

    // Their end is fine; ours is broken. The error must not tell a paying customer to go
    // and configure SMTP they are paying us not to need.
    it("reports an OPERATOR fault when the add-on is bought but platform SMTP is unset", async () => {
      clearPlatformEnv();
      await expect(resolveEnterpriseSender(onMailServiceId)).rejects.toThrow(PlatformSmtpNotConfiguredError);
    });

    it("treats a disabled add-on row as not purchased", async () => {
      expect(await hasPlatformEmailAddon(noSmtpId)).toBe(false);
      expect(await hasPlatformEmailAddon(onMailServiceId)).toBe(true);
    });
  });

  describe("the billing log", () => {
    it("records a TENANT send as non-billable, with the metadata a bill needs", async () => {
      const { sender } = await sendEnterpriseMail({
        enterpriseId: withOwnSmtpId,
        kind: MAIL_KINDS.CONFIRMATION_LETTER,
        to: "guest@example.com",
        subject: "Booking Confirmation — ABC123",
        html: "<p>hi</p>",
      });
      expect(sender).toBe(MAIL_SENDER.TENANT);

      const rows = await prisma.emailLog.findMany({ where: { enterpriseId: withOwnSmtpId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].sender).toBe("TENANT");
      expect(rows[0].kind).toBe("confirmation-letter");
      expect(rows[0].status).toBe("SENT");
      expect(rows[0].toAddress).toBe("guest@example.com");
      expect(rows[0].fromAddress).toBe("reservations@hotel.test");
      expect(rows[0].messageId).toBe("<msg-id@test>");
    });

    it("records a PLATFORM send — the row an invoice is counted from", async () => {
      await sendEnterpriseMail({
        enterpriseId: onMailServiceId,
        kind: MAIL_KINDS.CONFIRMATION_LETTER,
        to: "guest@example.com",
        subject: "Booking Confirmation — XYZ",
        html: "<p>hi</p>",
      });

      const rows = await prisma.emailLog.findMany({ where: { enterpriseId: onMailServiceId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].sender).toBe("PLATFORM");
      expect(rows[0].fromAddress).toBe("noreply@platform.test");
    });

    // A rejected send must be visible AND must not be counted as delivered.
    it("writes a FAILED row and still rethrows when the provider rejects", async () => {
      transportMock.deliverSmtp.mockRejectedValueOnce(new Error("554 Message rejected"));

      await expect(
        sendEnterpriseMail({
          enterpriseId: onMailServiceId,
          kind: MAIL_KINDS.CONFIRMATION_LETTER,
          to: "guest@example.com",
          subject: "Booking Confirmation",
          html: "<p>hi</p>",
        })
      ).rejects.toThrow("554 Message rejected");

      const rows = await prisma.emailLog.findMany({ where: { enterpriseId: onMailServiceId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("FAILED");
      expect(rows[0].errorMessage).toContain("554");
      expect(rows[0].messageId).toBeNull();
    });

    it("writes NO row when there was no sender to send with — nothing was sent", async () => {
      await expect(
        sendEnterpriseMail({
          enterpriseId: noSmtpId,
          kind: MAIL_KINDS.CONFIRMATION_LETTER,
          to: "guest@example.com",
          subject: "Booking Confirmation",
          html: "<p>hi</p>",
        })
      ).rejects.toThrow(SmtpNotConfiguredError);

      expect(await prisma.emailLog.count({ where: { enterpriseId: noSmtpId } })).toBe(0);
      expect(transportMock.deliverSmtp).not.toHaveBeenCalled();
    });

    // Uppsolut's own mail about a tenant is tagged to them for traceability but is always
    // PLATFORM — the usage report excludes these kinds from the billable count.
    it("tags platform mail to an enterprise without making it the tenant's send", async () => {
      await sendPlatformMail({
        kind: MAIL_KINDS.ENTERPRISE_WELCOME,
        enterpriseId: onMailServiceId,
        to: "owner@example.com",
        subject: "Your sign-in details",
        html: "<p>welcome</p>",
      });

      const rows = await prisma.emailLog.findMany({ where: { enterpriseId: onMailServiceId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].sender).toBe("PLATFORM");
      expect(rows[0].kind).toBe("enterprise-welcome");
    });

    it("never stores the message body", async () => {
      await sendEnterpriseMail({
        enterpriseId: withOwnSmtpId,
        kind: MAIL_KINDS.ENTERPRISE_WELCOME,
        to: "owner@example.com",
        subject: "Your sign-in details",
        html: "<p>Temporary password: SuperSecret123</p>",
      });

      const row = (await prisma.emailLog.findFirst({ where: { enterpriseId: withOwnSmtpId } }))!;
      expect(JSON.stringify(row)).not.toContain("SuperSecret123");
    });
  });
});
