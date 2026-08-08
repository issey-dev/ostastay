import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPlatformSmtpConfig,
  isPlatformSmtpConfigured,
  getPlatformAlertRecipients,
  isTenantSmtpConfigured,
  resolveTenantSmtp,
  SmtpNotConfiguredError,
  type SmtpConfig,
} from "@/lib/mailer";
import {
  escapeHtml,
  buildEnterpriseWelcomeEmail,
  buildChannelAlertEmail,
  appBaseUrl,
} from "@/lib/email-templates";
import { encryptSecret } from "@/lib/secret-crypto";

// Two independent SMTP senders: the TENANT's (EnterpriseSettings, guest mail) and the
// PLATFORM's (environment, Uppsolut Stay's own mail). These tests pin the boundary between
// them and the env parsing that decides whether platform mail is on at all — the failure
// that matters is a half-configured environment silently behaving as if it were configured.

const PLATFORM_ENV_KEYS = [
  "PLATFORM_SMTP_HOST",
  "PLATFORM_SMTP_PORT",
  "PLATFORM_SMTP_USERNAME",
  "PLATFORM_SMTP_PASSWORD",
  "PLATFORM_SMTP_FROM_ADDRESS",
  "PLATFORM_SMTP_FROM_NAME",
  "PLATFORM_SMTP_USE_TLS",
  "PLATFORM_ALERT_EMAIL",
  "APP_URL",
] as const;

function clearPlatformEnv() {
  for (const k of PLATFORM_ENV_KEYS) delete process.env[k];
}

function setMinimalPlatformEnv() {
  process.env.PLATFORM_SMTP_HOST = "email-smtp.eu-north-1.amazonaws.com";
  process.env.PLATFORM_SMTP_USERNAME = "smtp-user";
  process.env.PLATFORM_SMTP_PASSWORD = "smtp-pass";
  process.env.PLATFORM_SMTP_FROM_ADDRESS = "noreply@mail.example.com";
}

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of PLATFORM_ENV_KEYS) originalEnv[k] = process.env[k];
  clearPlatformEnv();
});

afterEach(() => {
  clearPlatformEnv();
  for (const k of PLATFORM_ENV_KEYS) {
    if (originalEnv[k] !== undefined) process.env[k] = originalEnv[k];
  }
});

describe("platform SMTP configuration", () => {
  it("is off when nothing is set", () => {
    expect(getPlatformSmtpConfig()).toBeNull();
    expect(isPlatformSmtpConfigured()).toBe(false);
  });

  it("reads a complete configuration and applies the defaults", () => {
    setMinimalPlatformEnv();
    const smtp = getPlatformSmtpConfig();
    expect(smtp).not.toBeNull();
    expect(smtp!.host).toBe("email-smtp.eu-north-1.amazonaws.com");
    expect(smtp!.port).toBe(587);
    expect(smtp!.useTls).toBe(true);
    expect(smtp!.fromName).toBe("Uppsolut Stay");
    expect(isPlatformSmtpConfigured()).toBe(true);
  });

  // The important one: a partially-filled environment must be treated as OFF, not as
  // configured-with-blanks. Anything else turns a deployment mistake into a send attempt
  // that fails at the SMTP layer, far away from the cause.
  it.each([
    ["PLATFORM_SMTP_HOST"],
    ["PLATFORM_SMTP_USERNAME"],
    ["PLATFORM_SMTP_PASSWORD"],
    ["PLATFORM_SMTP_FROM_ADDRESS"],
  ])("is off when %s alone is missing", (missing) => {
    setMinimalPlatformEnv();
    delete process.env[missing];
    expect(getPlatformSmtpConfig()).toBeNull();
    expect(isPlatformSmtpConfigured()).toBe(false);
  });

  it("treats a blank-but-present value as missing", () => {
    setMinimalPlatformEnv();
    process.env.PLATFORM_SMTP_HOST = "   ";
    expect(getPlatformSmtpConfig()).toBeNull();
  });

  it("honours an explicit port and falls back on a nonsense one", () => {
    setMinimalPlatformEnv();
    process.env.PLATFORM_SMTP_PORT = "465";
    expect(getPlatformSmtpConfig()!.port).toBe(465);

    process.env.PLATFORM_SMTP_PORT = "not-a-port";
    expect(getPlatformSmtpConfig()!.port).toBe(587);
  });

  // STARTTLS must be opt-OUT: an unrecognised value has to keep TLS on, never silently
  // downgrade the connection to plaintext.
  it("only disables TLS for a literal 'false'", () => {
    setMinimalPlatformEnv();
    process.env.PLATFORM_SMTP_USE_TLS = "false";
    expect(getPlatformSmtpConfig()!.useTls).toBe(false);

    process.env.PLATFORM_SMTP_USE_TLS = "FALSE";
    expect(getPlatformSmtpConfig()!.useTls).toBe(false);

    for (const v of ["true", "yes", "0", "", "off", "no"]) {
      process.env.PLATFORM_SMTP_USE_TLS = v;
      expect(getPlatformSmtpConfig()!.useTls).toBe(true);
    }
  });
});

describe("platform alert recipients", () => {
  it("is empty when unset — alerting off is a valid configuration", () => {
    expect(getPlatformAlertRecipients()).toEqual([]);
  });

  it("splits, trims and drops entries that are not addresses", () => {
    process.env.PLATFORM_ALERT_EMAIL = " ops@example.com , dev@example.com ,, not-an-email ";
    expect(getPlatformAlertRecipients()).toEqual(["ops@example.com", "dev@example.com"]);
  });
});

describe("tenant SMTP configuration", () => {
  const complete: SmtpConfig = {
    smtpHost: "smtp.hotel.com",
    smtpPort: 587,
    smtpUsername: "hotel",
    smtpPassword: "pw",
    smtpFromAddress: "reservations@hotel.com",
    smtpUseTls: true,
  };

  it("recognises a complete configuration", () => {
    expect(isTenantSmtpConfigured(complete)).toBe(true);
    expect(isTenantSmtpConfigured(null)).toBe(false);
  });

  it.each([
    ["smtpHost"],
    ["smtpPort"],
    ["smtpUsername"],
    ["smtpPassword"],
    ["smtpFromAddress"],
  ] as const)("is unconfigured when %s is missing", (field) => {
    expect(isTenantSmtpConfigured({ ...complete, [field]: null })).toBe(false);
  });

  it("decrypts the stored password at point of use", () => {
    process.env.SECRETS_ENCRYPTION_KEY = "test-key-for-mailer";
    try {
      const stored = encryptSecret("real-smtp-password")!;
      expect(stored).not.toContain("real-smtp-password");

      const resolved = resolveTenantSmtp({ ...complete, smtpPassword: stored });
      expect(resolved.password).toBe("real-smtp-password");
      expect(resolved.host).toBe("smtp.hotel.com");
    } finally {
      delete process.env.SECRETS_ENCRYPTION_KEY;
    }
  });

  it("throws SmtpNotConfiguredError rather than sending with blanks", () => {
    expect(() => resolveTenantSmtp(null)).toThrow(SmtpNotConfiguredError);
    expect(() => resolveTenantSmtp({ ...complete, smtpHost: null })).toThrow(SmtpNotConfiguredError);
  });

  // The platform sender and the tenant sender must not bleed into each other: a tenant
  // with no SMTP of its own must NOT quietly fall back to sending guest mail as Uppsolut.
  it("does not fall back to the platform sender", () => {
    setMinimalPlatformEnv();
    expect(isPlatformSmtpConfigured()).toBe(true);
    expect(isTenantSmtpConfigured(null)).toBe(false);
    expect(() => resolveTenantSmtp(null)).toThrow(SmtpNotConfiguredError);
  });
});

describe("email templates", () => {
  it("escapes HTML metacharacters", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
    expect(escapeHtml("Ali & Sons")).toBe("Ali &amp; Sons");
  });

  it("carries the sign-in details and points the link at APP_URL", () => {
    process.env.APP_URL = "https://stay.example.com";
    const mail = buildEnterpriseWelcomeEmail({
      firstName: "Aisha",
      email: "aisha@hotel.com",
      password: "Abc123XyZ789",
      enterpriseName: "Blue Lagoon Resorts",
      enterpriseSlug: "blue-lagoon",
    });

    for (const body of [mail.html, mail.text]) {
      expect(body).toContain("Abc123XyZ789");
      expect(body).toContain("blue-lagoon");
      expect(body).toContain("aisha@hotel.com");
      expect(body).toContain("https://stay.example.com/login");
    }
    expect(mail.subject).toContain("Blue Lagoon Resorts");
    // The temporary-password warning must survive in both alternatives, not just the HTML.
    expect(mail.text).toContain("temporary");
  });

  it("strips a trailing slash from APP_URL so links are not doubled", () => {
    process.env.APP_URL = "https://stay.example.com/";
    expect(appBaseUrl()).toBe("https://stay.example.com");
    const mail = buildEnterpriseWelcomeEmail({
      firstName: "A",
      email: "a@b.com",
      password: "p",
      enterpriseName: "E",
      enterpriseSlug: "e",
    });
    expect(mail.html).not.toContain("//login");
  });

  // An apostrophe or ampersand in a hotel's name is ordinary, not an attack — but it is
  // exactly what breaks unescaped markup, so the escaping has to hold on real input too.
  it("escapes hostile and merely awkward names in the welcome email", () => {
    const mail = buildEnterpriseWelcomeEmail({
      firstName: "<b>Bob</b>",
      email: "bob@hotel.com",
      password: "pw",
      enterpriseName: `Ali & Sons "Resort" <img src=x onerror=alert(1)>`,
      enterpriseSlug: "ali-sons",
    });
    expect(mail.html).not.toContain("<b>Bob</b>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&amp;");
  });

  it("lists every failing connection in the channel alert", () => {
    const mail = buildChannelAlertEmail({
      connections: [
        { enterpriseName: "Blue Lagoon", connectionName: "Main", provider: "BEDS24", error: "Authentication failed" },
        { enterpriseName: "Coral Bay", connectionName: "Backup", provider: "BEDS24", error: null },
      ],
    });

    expect(mail.subject).toContain("2 channel connections failing");
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain("Blue Lagoon");
      expect(body).toContain("Coral Bay");
      expect(body).toContain("Authentication failed");
      expect(body).toContain("Unknown error");
    }
  });

  it("uses the singular for one failing connection", () => {
    const mail = buildChannelAlertEmail({
      connections: [{ enterpriseName: "Solo", connectionName: "Main", provider: "BEDS24", error: "gone" }],
    });
    expect(mail.subject).toContain("1 channel connection failing");
    expect(mail.subject).not.toContain("connections");
  });

  it("escapes provider error text, which is not authored by us", () => {
    const mail = buildChannelAlertEmail({
      connections: [
        {
          enterpriseName: "E",
          connectionName: "C",
          provider: "BEDS24",
          error: `<script>alert("beds24")</script>`,
        },
      ],
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
