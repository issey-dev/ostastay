import * as beds24 from "@/lib/channels/beds24";
import { buildCalendarPayload, countNights, isValidPriceSlot, MAX_PRICE_SLOTS } from "@/lib/channels/payload";
import { parseBeds24Booking, extractBookings, isCancelledStatus } from "@/lib/channels/inbound/parse";
import type { ChannelProvider } from "@/lib/channels/provider";

// Beds24 implementation of ChannelProvider. Every field here is a thin pass-through to the
// already-verified Beds24 client/wire-format modules — this file's only job is to satisfy
// the provider-agnostic shape everything else in src/lib/channels depends on, not to
// reimplement anything.

export const beds24Provider: ChannelProvider = {
  id: "BEDS24",
  displayName: "Beds24",
  refreshTokenIdleDays: beds24.REFRESH_TOKEN_IDLE_DAYS,
  rateIdLabel: `Price slot (1–${MAX_PRICE_SLOTS})`,

  exchangeInviteCode: beds24.exchangeInviteCode,
  refreshAccessToken: beds24.refreshAccessToken,
  isAccessTokenStale: beds24.isAccessTokenStale,
  daysUntilRefreshTokenExpiry: beds24.daysUntilRefreshTokenExpiry,
  needsKeepAlive: beds24.needsKeepAlive,
  toConnectionError: beds24.toConnectionError,

  buildAvailabilityPayload(plan) {
    const payload = buildCalendarPayload(plan);
    return { payload, roomTypeCount: payload.length, nightCount: countNights(payload) };
  },
  async pushAvailability(accessToken, payload, sink) {
    await beds24.pushCalendar(accessToken, payload, sink);
  },
  isValidRateId: isValidPriceSlot,

  fetchRecentBookings: beds24.fetchBookings,
  extractBookings,
  parseBooking: parseBeds24Booking,
  isCancelledStatus,
};
