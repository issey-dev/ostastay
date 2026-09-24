# Uppsolut Stay — Booking API (developer reference)

The developer reference now lives in the documentation portal, which is the single source
of truth for the Booking API — rooms, excursions, spa, webhooks, errors and limits:

- **Portal:** `/docs/api` on the Uppsolut Stay host
  (e.g. `https://stay.uppsolut.com/docs/api`; locally
  `http://localhost:3000/docs/api`).
- **OpenAPI 3.1:** `/docs/booking-api.openapi.yaml` (source: `public/docs/booking-api.openapi.yaml`).
- **PDF:** `/docs/uppsolut-stay-booking-api-guide.pdf`, generated from the portal with
  `npm run docs:pdf`.

Maintainers: the portal pages are in `src/app/docs`. Keep them, the OpenAPI file and
`src/app/api/website/v1/**` in step, and run `npm run docs:check` — published docs must
never carry a secret, a real customer's name or an internal detail.
