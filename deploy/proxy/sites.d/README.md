# Adding another project to this host

The proxy owns ports 80 and 443. **Your project should not publish any host port** —
that is what causes two projects to fight over port 3000. Instead your container joins
the shared `edge` network and the proxy reaches it by service name.

Two steps.

## 1. Put your service on the `edge` network

In your project's own `docker-compose.yml`:

```yaml
services:
  web:                     # whatever your service is called
    # note: no `ports:` and no `container_name:`
    networks:
      - default            # your own private network, for your database etc.
      - edge               # so the proxy can reach you
    deploy:
      resources:
        limits:
          cpus: "1.0"      # please set these — see below
          memory: 1G

networks:
  edge:
    external: true
```

Keep your database on `default` only, never on `edge`. Nothing outside your own stack
should be able to reach it.

## 2. Drop one file in this directory

Create `sites.d/yourproject.caddy`:

```caddy
yourproject.example.com {
	import security_headers
	reverse_proxy web:3000
}
```

`web` is your compose **service name** and `3000` its container-internal port. Then:

```bash
cd ~/ostastay/deploy/proxy && docker compose exec proxy caddy reload --config /etc/caddy/Caddyfile
```

Caddy fetches an HTTPS certificate automatically. The hostname must already have a DNS
record pointing at this server, or the certificate request will fail.

## Please set resource limits

This host has 4 CPUs and 7.6 GB of RAM shared between everyone. A container with no
limits can consume all of it and starve every other project — a build or a runaway query
is enough. `docker stats` shows what everything is actually using.

Current allocation:

| Stack | CPUs | Memory |
| --- | --- | --- |
| edge-proxy | 0.5 | 256 MB |
| Uppsolut PMS app | 2.0 | 2 GB |
| Uppsolut PMS Postgres | 1.0 | 1 GB |
| **Unallocated** | **~0.5** | **~4.3 GB** |

## Notes

- One file per project. Nobody edits the main `Caddyfile`, so a syntax error in your
  file cannot take down everyone else's site — and `caddy reload` validates before
  applying, leaving the old config running if yours is broken.
- `import security_headers` gives you HSTS, `X-Frame-Options`, `nosniff`, and a
  `Referrer-Policy` for free. Leave it in unless you have a specific reason.
