import type { ChannelLogSink } from "@/lib/channels/beds24";
import type { ChannelAvailabilityPlan } from "@/lib/channels/sync";
import type { ParsedBooking } from "@/lib/channels/inbound/parse";

// The seam between the Hub/sync engine and any one channel manager's actual wire format.
//
// Everything upstream of this file — connection.ts, push.ts, poll.ts, ingest.ts, the Hub's
// API routes, the scheduled jobs — talks to a ChannelConnection through this interface and
// never imports a provider-specific module directly. Beds24Provider (providers/beds24.ts)
// is the only implementation today, but a second channel manager is added by writing one
// more file that satisfies this interface and registering it in providers/registry.ts —
// nothing above this line changes.
//
// A connection's `provider` column (ChannelConnection.provider, already on the schema) is
// what makes the choice per-connection rather than global.

export type ProviderTokenPair = {
  refreshToken: string;
  accessToken: string;
  /** Absolute expiry, derived from whatever relative lifetime the provider's API reports. */
  accessTokenExpiresAt: Date;
};

export type ProviderAccessToken = {
  accessToken: string;
  accessTokenExpiresAt: Date;
};

export type AvailabilityPayload = {
  /** The exact wire-format body — provider-specific shape, opaque to every caller. */
  payload: unknown;
  roomTypeCount: number;
  nightCount: number;
};

export interface ChannelProvider {
  /** Stored on ChannelConnection.provider. Must match a PROVIDERS entry in registry.ts. */
  readonly id: string;
  readonly displayName: string;
  /** How long an unused refresh token survives before the provider kills it. */
  readonly refreshTokenIdleDays: number;
  /** Short UI hint for what a rate-plan mapping's external id actually means to this provider. */
  readonly rateIdLabel: string;

  // --- Auth ---
  exchangeInviteCode(code: string, sink?: ChannelLogSink): Promise<ProviderTokenPair>;
  refreshAccessToken(refreshToken: string, sink?: ChannelLogSink): Promise<ProviderAccessToken>;
  isAccessTokenStale(expiresAt: Date | null | undefined): boolean;
  daysUntilRefreshTokenExpiry(lastTokenRefreshAt: Date | null | undefined): number | null;
  needsKeepAlive(lastTokenRefreshAt: Date | null | undefined): boolean;
  /** Turn a thrown error into a short operator-readable reason. Never echoes raw response bodies. */
  toConnectionError(e: unknown): string;

  // --- Outbound: availability + rates ---
  /** Build the exact body this provider expects from a provider-agnostic availability plan. */
  buildAvailabilityPayload(plan: ChannelAvailabilityPlan): AvailabilityPayload;
  pushAvailability(accessToken: string, payload: unknown, sink?: ChannelLogSink): Promise<void>;
  /** Is this a usable value for a rate plan's external-id mapping (e.g. Beds24's price1..16 slots)? */
  isValidRateId(value: string): boolean;

  // --- Inbound: bookings ---
  fetchRecentBookings(accessToken: string, since: Date, sink?: ChannelLogSink): Promise<unknown>;
  /** Pull the booking list out of whatever envelope this provider's webhook/poll response uses. */
  extractBookings(payload: unknown): unknown[];
  parseBooking(raw: unknown): ParsedBooking;
  isCancelledStatus(status: string | null): boolean;
}
