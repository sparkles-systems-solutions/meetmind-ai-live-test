# MeetMind AI API

Live API source for the MeetMind AI web workspace and separate administrator console.

## API endpoints

- `GET /health`
- `POST /api/v1/auth/bootstrap` — one-time administrator creation, protected by `BOOTSTRAP_SECRET`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/meetings`
- `POST /api/v1/meetings` — create/upsert
- `GET /api/v1/meetings/:id`
- `PUT /api/v1/meetings/:id`
- `DELETE /api/v1/meetings/:id`
- `GET /api/v1/admin/overview` — admin only
- `GET /api/v1/admin/users` — admin only

Passwords are PBKDF2-SHA256 hashed. API tokens are HS256 signed with an eight-hour expiry. Meeting records are scoped to the authenticated user. The browser client never contains server secrets.

## First deployment

1. In Cloudflare, create a D1 database named `meetmind-ai-db`, or run `npx wrangler d1 create meetmind-ai-db`.
2. Put the returned database ID in `wrangler.toml` at `database_id`.
3. From this folder, apply the migration: `npx wrangler d1 migrations apply meetmind-ai-db --remote`.
4. Configure Worker secrets: `npx wrangler secret put JWT_SECRET` and `npx wrangler secret put BOOTSTRAP_SECRET`. Use long random values.
5. Deploy: `npx wrangler deploy`.
6. In the web app Settings, enter the Worker URL and sign in.
7. Create the first admin with the one-time bootstrap endpoint below.

### Bootstrap the first administrator

Send a POST request to `https://YOUR-WORKER/api/v1/auth/bootstrap` with JSON body `{"email":"admin@example.com","password":"use-a-long-unique-password"}` and header `X-Bootstrap-Secret: YOUR_BOOTSTRAP_SECRET`. This endpoint only succeeds when the users table is empty. Keep the bootstrap secret private and rotate it after initial setup.

## Automatic GitHub Actions deployment

The repository workflow `.github/workflows/deploy-api.yml` deploys the API when API files change. Configure these GitHub repository Actions secrets first:

- `CLOUDFLARE_API_TOKEN` — token with Workers Scripts edit and D1 edit permissions
- `CLOUDFLARE_ACCOUNT_ID`
- `JWT_SECRET`
- `BOOTSTRAP_SECRET`

The D1 database must already exist and its ID must be committed in `wrangler.toml`. The workflow applies D1 migrations and deploys the Worker. Never commit actual secrets.

## Cost and AI status

The API stores account data, meeting transcripts and minutes. It does not call paid speech-recognition or translation APIs. Automatic Sinhala translation and a dedicated multilingual ASR engine are not active until a free/local engine is selected, integrated and tested. Cloudflare Workers and D1 free-plan quotas apply; limits can change and requests can fail when quotas are exhausted.

## Security

- HTTPS only; CORS is restricted to the configured frontend origin.
- Secrets must be configured as Worker secrets, never as source variables.
- Per-user ownership checks protect meeting records.
- The admin endpoints require the admin role.
- The API stores transcripts in D1; users should obtain participant consent and follow applicable privacy requirements.
