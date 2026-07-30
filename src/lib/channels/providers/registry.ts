import type { ChannelProvider } from "@/lib/channels/provider";
import { beds24Provider } from "@/lib/channels/providers/beds24-provider";

// The one place a new channel manager gets wired in. Adding a provider is: implement
// ChannelProvider, add it to this list — connection.ts, push.ts, poll.ts, ingest.ts and the
// Hub API routes all resolve providers through getProvider() and need no further changes.
export const PROVIDERS: readonly ChannelProvider[] = [beds24Provider];

export const DEFAULT_PROVIDER_ID = beds24Provider.id;

export function getProvider(id: string): ChannelProvider {
  const found = PROVIDERS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown channel-manager provider "${id}"`);
  return found;
}
