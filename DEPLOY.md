# Deploying Uppsolut PMS with Docker

Three containers: a shared edge proxy (Caddy) that owns 80/443 for every project on the
host, the app (Node 22), and PostgreSQL 17 — plus volumes for the database and the
eRegistration ID photos.

Neither the app nor Postgres publishes a host port. The app is reachable only through
the proxy, so nothing can bypass its TLS, security headers, or rate limits; Postgres is
reachable only from the app container.

Target host: `192.99.167.15` (`vps-9d96501a.vps.ovh.ca`), user `ubuntu`.
Live at **https://stay.uppsolut.com** (`vps-9d96501a.vps.ovh.ca` still works as a fallback
hostname — both are configured on the same Caddy site block).

---

## 1. Install Docker on the server

Once per machine. Ubuntu:

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER && newgrp docker
```

Verify: `docker run --rm hello-world`

---

## 2. Get the code onto the server

```bash
git clone https://github.com/issey-dev/ostastay.git ~/ostastay && cd ~/ostastay
```

For later updates, see [Updating](#updating-to-a-new-version).

---

## 3. Configure

```bash
cp .env.production.example .env
openssl rand -hex 32   # run three times, one value per secret below
nano .env
```

Fill in `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRETS_ENCRYPTION_KEY`, and `CRON_SECRET`,
and confirm `APP_URL` matches how guests will actually reach the app. `APP_URL` is what
gets embedded in the eRegistration links emailed to guests and in the sign-in link on the
enterprise welcome email — if it is wrong, those links point nowhere.

Fill in the `PLATFORM_SMTP_*` block too if this deployment should email enterprise
handover credentials and channel-manager alerts. It is optional: left blank, onboarding
still works and still shows the credentials on screen to hand over manually. See
[Email](#email) below for which sender does what.

Set `POSTGRES_PASSWORD` **before the first start**: it is baked into the database volume
when that volume is created, so changing it later means an `ALTER USER` inside the
running container, not just an edit here.

`DATABASE_URL` is intentionally absent from `.env` — compose builds it from
`POSTGRES_PASSWORD` so the app and the database can never disagree about credentials.

---

## 4. Start the shared proxy (once per host)

The proxy owns ports 80/443 and serves every project on this machine. The app publishes
no host port at all — it is reached through here, which is what stops projects colliding
on port 3000 and gives each one HTTPS automatically.

```bash
docker network create edge
```

```bash
cd ~/ostastay/deploy/proxy && docker compose up -d --build
```

Caddy obtains a Let's Encrypt certificate on first start. Colleagues adding their own
projects should read [`deploy/proxy/sites.d/README.md`](deploy/proxy/sites.d/README.md)
— they drop one file in `sites.d/` and never edit the shared `Caddyfile`.

## 5. Start the app

```bash
cd ~/ostastay && docker compose up -d --build
```

First build takes a few minutes. The container applies all database migrations on every
boot before the server starts, so there is no separate migrate step.

Watch it come up:

```bash
docker compose logs -f
```

---

## 6. Create the first admin account

The internal "Osta" enterprise (the platform-admin side that manages customer
enterprises and channel-manager connections) exists by default — every container start
ensures it, along with its system roles. What a fresh database does NOT have is any
user: accounts need a password, and a default password would be a well-known credential
on every deployment. This one command creates yours. Run it once, after the first
successful start:

```bash
docker compose exec \
  -e ADMIN_EMAIL=you@example.com \
  -e ADMIN_PASSWORD='a-long-random-password' \
  app node dist-scripts/scripts/bootstrap-admin.js
```

The password is passed per-invocation rather than stored in `.env`, so it never lands in
a file or in the image. Minimum 12 characters.

Then sign in at `https://stay.uppsolut.com` with:

- **Enterprise code:** `osta`
- **Email / password:** what you just set

From there, create your hotel's own enterprise and its properties through the app.

> Re-running the same command with a different `ADMIN_PASSWORD` resets that account's
> password. That is the recovery path if you get locked out.

---

## 7. Schedule the background jobs

The job runner keeps channel-manager credentials alive (Beds24 refresh tokens expire
after 30 days idle) and prunes the exchange log. Nothing calls it automatically — add a
host cron entry, using the same `CRON_SECRET` you put in `.env`:

```bash
crontab -e
```

```cron
# Uppsolut PMS background jobs — hourly
0 * * * * curl -fsS -X POST -H "x-cron-secret: YOUR_CRON_SECRET" https://stay.uppsolut.com/api/jobs/run > /dev/null 2>&1
```

If you skip this, the app still works; channel-manager tokens will eventually expire.

---

## Email

There are **two independent senders**, and almost every email question starts with
working out which one applies.

| | Tenant SMTP | Platform SMTP |
| --- | --- | --- |
| Sends | Confirmation letters, eRegistration links, debtor statements | Enterprise handover credentials, channel-manager alerts |
| From | The hotel's own domain | `noreply@mail.uppsolut.com` |
| Configured by | The tenant, in-app: Controls → Reports → SMTP / SFTP | You, in `.env`: `PLATFORM_SMTP_*` |
| Stored | `EnterpriseSettings`, encrypted at rest | Environment only, never in the database |
| If missing | Those buttons fail with "SMTP is not configured" — unless the enterprise is on the mail service, below | Onboarding still works; credentials shown on screen to hand over manually |

### The Uppsolut Mail Service (billed add-on)

An enterprise with no SMTP of its own can send through the platform sender instead. Grant it
on the Osta enterprise page → **Add-ons** → *Uppsolut Mail Service*; it is off until then, as
every add-on is.

Precedence is fixed and worth knowing: **a tenant's own SMTP always wins.** The service is a
fallback for enterprises that have none, never a takeover for one that has configured its own
domain. So granting it to a customer who later sets up their own SMTP silently stops costing
them anything, which is the correct behaviour.

Every send is recorded in `EmailLog` — metadata only, no message bodies. **Osta Controls →
Email usage** reports counts per enterprise for a period, split into billable (sent on the
platform sender), failed (excluded — we did not deliver those), the enterprise's own SMTP
sends, and Uppsolut's own mail to them (handover credentials, channel alerts — never
billable). It reports counts and applies no rate: licensing amounts are hand-set here as
everywhere else.

This makes the platform sender load-bearing for those tenants. If `PLATFORM_SMTP_*` is unset
while an enterprise is on the service, their guest mail fails with a 503 that blames us, not
them — deliberately, so nobody tells a paying customer to configure SMTP they are paying not
to need.

Guest mail deliberately comes from the hotel's own domain — a booking confirmation that
arrives from Uppsolut rather than the property is the wrong sender for the recipient.
Platform mail exists because the other direction has no tenant to read config from: a
brand-new enterprise has no settings row and no domain of its own at the moment we need
to email its first admin their password.

Both sides have a **Test connection** button, and both distinguish two failure modes that
are worth keeping apart:

- *Could not connect* — host, port, TLS or credentials are wrong.
- *Connected, but the message was rejected* — the login is fine and the provider refused
  the envelope. Sending domain not verified, or the account is restricted.

### Amazon SES

If `PLATFORM_SMTP_HOST` is an `email-smtp.*.amazonaws.com` endpoint, three things must all
be true, and only the first is covered by a connection test:

1. **The SMTP credentials are valid.** These are SES-specific — an SES SMTP username is
   not an ordinary IAM access key, even though it looks like one.
2. **The sending domain is verified in the same region as the endpoint.** An identity
   verified in `eu-west-1` does nothing for an `eu-north-1` endpoint. DKIM CNAMEs, and an
   SPF `include:amazonses.com` on the MAIL FROM subdomain, should all be in DNS.
3. **The account has production access.** A new SES account is in the **sandbox**: it can
   only send to individually verified addresses, capped at 200 messages a day. It
   authenticates normally and then rejects everything else with
   `554 Message rejected: Email address is not verified`. Onboarding mail goes to
   brand-new customers by definition, so the sandbox blocks the feature entirely — request
   production access in the SES console before relying on it.

---

## Everyday operations

| Task | Command |
| --- | --- |
| Status | `docker compose ps` |
| Logs (live) | `docker compose logs -f` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` (volumes survive) |
| Shell inside | `docker compose exec app sh` |

---

## Backups

The `osta-db` volume is the entire business: every reservation, folio, payment, and
guest profile. `osta-uploads` holds guest ID photos.

`pg_dump` is safe to run against a live database — it takes a consistent snapshot
without blocking anyone:

```bash
mkdir -p ~/backups
docker compose exec -T db pg_dump -U osta -d ostastay --clean --if-exists \
  | gzip > ~/backups/osta-$(date +%F).sql.gz
docker run --rm -v ostastay_osta-uploads:/src -v ~/backups:/out alpine \
  tar czf /out/uploads-$(date +%F).tar.gz -C /src .
```

Copy those files off the server — a backup that only exists on the same VPS is not a
backup.

Automate it daily with `crontab -e`:

```cron
30 3 * * * cd ~/ostastay && docker compose exec -T db pg_dump -U osta -d ostastay --clean --if-exists | gzip > ~/backups/osta-$(date +\%F).sql.gz
```

To restore into a running stack:

```bash
gunzip -c ~/backups/osta-2026-08-02.sql.gz | docker compose exec -T db psql -U osta -d ostastay
```

---

## Updating to a new version

**Normally you never do this by hand** — every push to `master` deploys itself via
GitHub Actions (`.github/workflows/deploy.yml`): the full test suite runs against a real
PostgreSQL first, and only a green suite reaches the server, which then does exactly the
manual procedure below. The team workflow is: develop on a feature branch, push/merge to
`master` when it is ready for production.

One-time setup for the pipeline:

1. GitHub → the repo's **Settings → Secrets and variables → Actions → New repository
   secret**, named `VPS_SSH_KEY`, containing the PRIVATE deploy key whose public half is
   in `ubuntu@vps`'s `~/.ssh/authorized_keys` (the `id_ed25519_ostastay_deploy` key).
   Never commit this key; until the secret exists the deploy job fails with an auth
   error and the server is simply not touched.
2. Nothing on the server: the pipeline runs the same `git pull` + `docker compose build`
   + `up -d` a human would, and refuses (`--ff-only`) if the server's checkout has
   diverged from GitHub — if that happens, someone edited files on the server; resolve
   it there, deliberately.

The manual fallback (works whether or not the pipeline exists):

```bash
cd ~/ostastay
git pull
docker compose up -d --build
```

Migrations apply automatically on boot. Take a backup first if the release includes
schema changes.

---

## Scaling

The app service has no fixed container name and no host port, so it scales directly:

```bash
docker compose up -d --scale app=3
```

Caddy load-balances across every replica automatically — it proxies to the `app`
**service** name, and Docker's DNS returns all replica addresses. Sessions are stateless
JWTs, so no sticky sessions are needed.

**Read this before going past one replica:**

- **Guest ID photos are written to a local volume**
  (`src/lib/eregistration/storage.ts`). On *this* host that is fine: every replica mounts
  the same `osta-uploads` volume. Spreading replicas across *several machines* would need
  object storage (S3/MinIO) behind that module first — it is written as the seam for
  exactly that swap.
- **Each replica gets its own resource limits** (2 CPUs / 2 GB). Three replicas is
  6 CPUs on a 4-CPU box, which is oversubscribed. Check `docker stats` and the allocation
  table in [`deploy/proxy/sites.d/README.md`](deploy/proxy/sites.d/README.md).
- **The DB Health storage panel becomes per-replica.** `src/lib/db-metrics.ts` is an
  in-process ring buffer, so the Osta dashboard shows whichever replica served the
  request. Cosmetic, not a correctness problem.
- **One replica is almost certainly enough.** Front-desk traffic is a handful of requests
  per minute. Postgres will be the ceiling long before the app tier is, and it scales
  vertically for a long time. Scale when something measured tells you to.

---

## Troubleshooting

**Container restarts in a loop.** `docker compose logs app`. The most common cause is a
missing `JWT_SECRET` — the app refuses to boot in production without one rather than
fall back to a well-known development secret.

**"No INTERNAL (Osta) enterprise found".** Should no longer occur — the entrypoint
ensures the enterprise on every start (look for "Ensuring the Osta platform enterprise"
in `docker compose logs app`). If it does appear, that ensure step failed; its error is
in the same logs, and running the step-6 bootstrap repairs it by hand.

**Can't reach it from a browser.** Check in this order:

1. `docker compose ps` in `~/ostastay` — is the app healthy?
2. `cd ~/ostastay/deploy/proxy && docker compose logs proxy` — certificate problems show
   up here. A failed ACME challenge usually means DNS does not point at this host, or
   port 80 is blocked upstream.
3. `docker network inspect edge` — the app and the proxy must both be attached.

**Certificate won't issue.** Port 80 must be reachable from the internet for the ACME
challenge, even though the site itself runs on 443. Let's Encrypt also rate-limits
repeated failures, so fix the cause before retrying in a loop; the `caddy-data` volume
persists issued certificates across restarts precisely to avoid that.

**Emails aren't sending.** Work out which sender is involved first — see
[Email](#email). Guest mail uses the enterprise's own SMTP, configured inside the app
under Controls → Reports → SMTP / SFTP, not in `.env`; the tenant can check it with the
Test connection button there. Platform mail (handover credentials, channel alerts) uses
the `PLATFORM_SMTP_*` environment block, and Osta staff can check it under the platform
console's Controls → Platform email.

If a test says it connected but the message was rejected, the credentials are fine and
the provider is refusing the envelope — on Amazon SES that is almost always either an
unverified sending domain or an account still in the sandbox (see below).

**The build is killed partway through, or dies with "JavaScript heap out of memory".**
`next build` is the memory-hungry step and small VPS plans often have too little RAM.
Add swap once and rebuild:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
