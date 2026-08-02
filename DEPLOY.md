# Deploying OstaStay with Docker

Two containers — the app (Node 22, port 3000) and PostgreSQL 17 — plus two volumes for
the database and the eRegistration ID photos. Postgres is not published to the network:
only the app container can reach it.

Target host: `192.99.167.15` (`vps-9d96501a.vps.ovh.ca`), user `ubuntu`.

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
gets embedded in the eRegistration links emailed to guests — if it is wrong, those links
point nowhere.

Set `POSTGRES_PASSWORD` **before the first start**: it is baked into the database volume
when that volume is created, so changing it later means an `ALTER USER` inside the
running container, not just an edit here.

`DATABASE_URL` is intentionally absent from `.env` — compose builds it from
`POSTGRES_PASSWORD` so the app and the database can never disagree about credentials.

---

## 4. Start it

```bash
docker compose up -d --build
```

First build takes a few minutes. The container applies all database migrations on every
boot before the server starts, so there is no separate migrate step.

Watch it come up:

```bash
docker compose logs -f
```

---

## 5. Create the first admin account

A freshly migrated database has no users, and the app needs its internal "Osta"
enterprise row to exist before any request can be served. This one command creates both.
Run it once, after the first successful start:

```bash
docker compose exec \
  -e ADMIN_EMAIL=you@example.com \
  -e ADMIN_PASSWORD='a-long-random-password' \
  app node dist-scripts/scripts/bootstrap-admin.js
```

The password is passed per-invocation rather than stored in `.env`, so it never lands in
a file or in the image. Minimum 12 characters.

Then sign in at `http://192.99.167.15:3000` with:

- **Enterprise code:** `osta`
- **Email / password:** what you just set

From there, create your hotel's own enterprise and its properties through the app.

> Re-running the same command with a different `ADMIN_PASSWORD` resets that account's
> password. That is the recovery path if you get locked out.

---

## 6. Schedule the background jobs

The job runner keeps channel-manager credentials alive (Beds24 refresh tokens expire
after 30 days idle) and prunes the exchange log. Nothing calls it automatically — add a
host cron entry, using the same `CRON_SECRET` you put in `.env`:

```bash
crontab -e
```

```cron
# OstaStay background jobs — hourly
0 * * * * curl -fsS -X POST -H "x-cron-secret: YOUR_CRON_SECRET" http://127.0.0.1:3000/api/jobs/run > /dev/null 2>&1
```

If you skip this, the app still works; channel-manager tokens will eventually expire.

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

```bash
cd ~/ostastay
git pull
docker compose up -d --build
```

Migrations apply automatically on boot. Take a backup first if the release includes
schema changes.

---

## Adding HTTPS later

The app currently serves plain HTTP. Guests submit passport and ID photos through
eRegistration, so those submissions — and every staff login — travel unencrypted, and
browsers will mark the site "Not Secure". Switching is one command once DNS is ready:

1. Point a DNS A record at `192.99.167.15`, or use `vps-9d96501a.vps.ovh.ca`, which
   already resolves there.
2. In `.env`, add `DOMAIN=your.domain` and change `APP_URL` to `https://your.domain`.
3. Open ports 80 and 443 (port 80 is required for the certificate challenge).
4. Start with the TLS overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d --build
```

Caddy fetches and renews the Let's Encrypt certificate on its own, and the app stops
being reachable directly on port 3000.

---

## Troubleshooting

**Container restarts in a loop.** `docker compose logs app`. The most common cause is a
missing `JWT_SECRET` — the app refuses to boot in production without one rather than
fall back to a well-known development secret.

**"No INTERNAL (Osta) enterprise found".** The bootstrap in step 5 has not been run yet.

**Can't reach it from a browser.** Confirm the container is healthy
(`docker compose ps`), then check the provider firewall — OVH instances commonly block
inbound ports by default. On the host: `sudo ufw allow 3000/tcp`.

**Emails aren't sending.** SMTP is configured per-enterprise inside the app under
Controls → Stationaries, not in `.env`.

**The build is killed partway through, or dies with "JavaScript heap out of memory".**
`next build` is the memory-hungry step and small VPS plans often have too little RAM.
Add swap once and rebuild:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
