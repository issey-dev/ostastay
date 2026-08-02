# Caddy with the rate-limiting module compiled in.
#
# The stock caddy image has no rate limiting, and this deployment needs it in the proxy
# rather than in the app: OstaStay's login throttle (src/lib/login-rate-limit.ts) is an
# in-process Map, so the moment the app runs more than one replica an attacker gets
# five attempts PER REPLICA and round-robin balancing multiplies the real limit. A limit
# enforced here is independent of how many app containers are running.
FROM caddy:2-builder-alpine AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
