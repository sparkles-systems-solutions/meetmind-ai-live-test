# MeetMind AI API

Production-oriented API source for the MeetMind AI web client.

## Endpoints

- GET /health
- POST /api/v1/auth/bootstrap (one-time admin creation; protected by BOOTSTRAP_SECRET)
- POST /api/v1/auth/login
- GET /api/v1/auth/me
- GET /api/v1/meetings
- POST /api/v1/meetings (create or upsert)
- GET /api/v1/meetings/:id
- PUT /api/v1/meetings/:id
- DELETE /api/v1/meetings/:id

All meeting records are isolated by authenticated user ID. Passwords use PBKDF2-SHA256. API tokens are signed HS256 tokens with an eight-hour expiry. No API secret is placed in browser code.

## Deployment prerequisites

1. Create a Cloudflare D1 database named `meetmind-ai-db`.
2. Replace `database_id` in `wrangler.toml`.
3. Apply `schema.sql` to the D1 database.
4. Set Worker secrets `JWT_SECRET` and `BOOTSTRAP_SECRET` using Wrangler secrets. Use long random values.
5. Deploy this Worker from the `api` directory with Wrangler.
6. Set `ALLOWED_ORIGIN` to the exact production frontend origin.
7. Call the one-time bootstrap endpoint with `X-Bootstrap-Secret`, then immediately remove/rotate `BOOTSTRAP_SECRET`.
8. Configure the frontend with the deployed Worker URL. Do not put secrets in GitHub Pages.

## Cost and AI

This API stores meeting metadata, transcripts and bilingual minutes. It does not call paid speech or translation APIs. Speech recognition and Sinhala translation are separate integrations and must not be presented as active until a selected engine is configured and tested. Cloudflare Workers/D1 free-plan quotas apply; exceeding quotas can make requests fail.

## Security notes

- HTTPS is required.
- Keep secrets out of Git.
- Restrict CORS to the exact frontend origin.
- Use per-user ownership checks for all meeting records.
- Back up D1 before schema changes.
