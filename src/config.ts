import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Env var ${name} must be an integer, got: ${raw}`);
  return parsed;
}

/**
 * DRY_RUN defaults to TRUE. Going live is an explicit, deliberate act —
 * a missing or malformed env var must never result in real emails going out.
 */
function dryRun(): boolean {
  return optional("DRY_RUN", "true").toLowerCase() !== "false";
}

export const config = {
  databaseUrl: required("DATABASE_URL"),

  dryRun: dryRun(),
  testInbox: optional("TEST_INBOX", ""),

  dailySendCap: int("DAILY_SEND_CAP", 50),
  perDomainSendCap: int("PER_DOMAIN_SEND_CAP", 3),

  google: {
    serviceAccountJson: optional("GOOGLE_SERVICE_ACCOUNT_JSON", ""),
    leadsSheetId: optional("LEADS_SHEET_ID", ""),
    leadsSheetRange: optional("LEADS_SHEET_RANGE", "Leads!A:Z"),
    gmailSender: optional("GMAIL_SENDER", ""),
  },

  compliance: {
    legalName: optional("COMPANY_LEGAL_NAME", ""),
    postalAddress: optional("COMPANY_POSTAL_ADDRESS", ""),
    unsubscribeBaseUrl: optional("UNSUBSCRIBE_BASE_URL", ""),
  },
} as const;

if (config.dryRun && !config.testInbox) {
  console.warn("[config] DRY_RUN is on but TEST_INBOX is empty — drafts will be logged, not delivered.");
}
