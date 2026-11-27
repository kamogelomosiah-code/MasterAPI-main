# MasterAPI

One backend for all your apps. Each app gets its own API key and its own separate data, with:

- **Data CRUD** – any collection; filter, sort, page, bulk create/update/delete
- **User accounts** – sign-up, log-in, profiles, password change, user management
- **Key-value store** – settings, feature flags, any JSON by key
- **Counters** – atomic increments for views, likes, downloads
- **Webhooks** – signed POSTs to your app when its data changes
- **AI** – text generation via Hugging Face (optional)

Storage is MongoDB when `MONGODB_URI` is set, otherwise a JSON file (for local development).

## Run it

```bash
npm install
cp .env.example .env     # set MASTER_KEY and TOKEN_SECRET (and MONGODB_URI)
npm start                # http://localhost:3000  — docs at /api/docs
npm test                 # 15 end-to-end tests
```

To run the tests against a real MongoDB, set `TEST_MONGODB_URI`. The tests use a throwaway database and drop it afterwards.

### Deploy on Render

The repo has a `render.yaml`, so Render sets most of it up for you:

1. Render dashboard → **New → Blueprint** → pick this repo → **Apply**.
2. When asked, paste your MongoDB Atlas connection string as `MONGODB_URI`. In Atlas, under Network Access, allow Render to connect (`0.0.0.0/0` is the simple option).
3. Render generates `MASTER_KEY` and `TOKEN_SECRET` itself. Open the service → **Environment** and copy `MASTER_KEY`: it is your sign-in for the console.
4. When the deploy is live, open the service URL and sign in.

`CORS_ORIGINS` is `*` by default. Change it to your sites (comma-separated) once you know them. Add `HF_TOKEN` if you want the AI chat endpoint. In production the server refuses to start without `MASTER_KEY` and `TOKEN_SECRET`, and it won't fall back to file storage if MongoDB is unreachable. Check `/api/health`: it should say `"storage":"mongodb"`.

The free plan sleeps after 15 minutes of no traffic, so the first request afterwards takes about 30 seconds.

## The console

The home page (`/`) is a simple console. Sign in with your `MASTER_KEY` to:

- **Apps** – create apps, copy their keys, disable, replace keys, set limits, allowed websites and webhooks, delete
- **Data** – browse collections, search, create, edit and delete documents
- **Users** – see, disable or delete the people who signed up through an app
- **Settings & counters** – edit key-value settings and counters

The console works through the same API your apps use. With your master key it can also act as any app by sending `X-Master-Key` and `X-App-Id` instead of an app key.

## 1. Create an app (admin)

```bash
curl -X POST https://YOUR-API/api/admin/apps \
  -H "Authorization: Bearer $MASTER_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Video site","allowedOrigins":["https://my-video-site.com"]}'
```

The response has `apiKey` (`mk_live_…`). **It is shown only once.** Only a hash of it is stored. If you lose it, call `POST /api/admin/apps/:id/rotate-key`.

| Admin route | |
|---|---|
| `GET /api/admin/apps` | list apps |
| `POST /api/admin/apps` | create (`name`, `description`, `rateLimitPerMinute`, `allowedOrigins`, `webhookUrl`) |
| `GET /api/admin/apps/:id` | details, collections, 30-day usage, webhook secret |
| `PATCH /api/admin/apps/:id` | change settings; `{"active": false}` disables it |
| `POST /api/admin/apps/:id/rotate-key` | new key; the old one stops working |
| `DELETE /api/admin/apps/:id?purge=true` | delete (and with `purge`, all its data) |

## 2. Use it from your apps

Send `X-API-Key: mk_live_…` on every `/api/v1` request.

```js
const API = "https://YOUR-API/api/v1";
const api = (path, opts = {}) =>
  fetch(API + path, {
    ...opts,
    headers: { "X-API-Key": process.env.MASTERAPI_KEY, "Content-Type": "application/json", ...opts.headers },
  }).then((r) => r.json());

await api("/data/products", { method: "POST", body: JSON.stringify({ name: "Pen", price: 10 }) });
const { data, pagination } = await api("/data/products?sort=-price&limit=20&page=1");
```

### Data

| Route | |
|---|---|
| `GET /data` | your collections and their sizes |
| `GET /data/:collection` | list. `?limit=20&page=2` (or `offset`), `?sort=-createdAt,name`, `?fields=name,price`, `?status=active` (exact match), `?where={"price":{"$lt":50}}` |
| `POST /data/:collection/query` | same, with a JSON body `{ filter, sort, limit, offset, fields }` |
| `GET /data/:collection/count` | count matching documents |
| `GET /data/:collection/:id` | one document |
| `POST /data/:collection` | create one `{…}` or many `[{…}, …]` (max 1000). You may pass your own `id`. |
| `PATCH /data/:collection/:id` | merge fields (`null` removes a field) |
| `PUT /data/:collection/:id` | replace the document |
| `DELETE /data/:collection/:id` | delete one |
| `PATCH /data/:collection` | bulk update `{ "filter": {…}, "set": {…} }` |
| `DELETE /data/:collection` | bulk delete `{ "filter": {…} }`, or `?all=true` |

Filter operators: `$eq $ne $gt $gte $lt $lte $in $nin $exists $contains $startsWith`, plus `$or` and `$and`. `$contains` and `$startsWith` ignore case. Other operators (like `$where`) are rejected.

Every document gets `id`, `createdAt` and `updatedAt`. When a logged-in user creates a document it also gets `ownerId`, and `?mine=true` returns only that user's documents.

### User accounts (for the people using your app)

| Route | |
|---|---|
| `POST /auth/register` | `{ email, password, name?, profile? }` → `{ token, user }` |
| `POST /auth/login` | `{ email, password }` → `{ token, user }` |
| `GET /auth/me` · `PATCH /auth/me` · `DELETE /auth/me` | needs `Authorization: Bearer <token>` |
| `POST /auth/me/password` | `{ currentPassword, newPassword }` |
| `GET /auth/users?q=` · `PATCH /auth/users/:id` · `DELETE /auth/users/:id` | manage users (call from your server) |

Passwords need at least 8 characters with a letter and a number, and are hashed with scrypt. After 10 failed logins, that email is locked out for 15 minutes. Tokens last 7 days by default. Each app's users and tokens are separate.

### Key-value, counters, AI

```
GET/PUT/DELETE /kv/:key        PUT body: { "value": anything }
GET /kv?prefix=feature.
GET /counters/:name            POST /counters/:name/increment  { "by": 1 }
POST /ai/chat                  { "prompt": "…" } or { "messages": [...], "system": "…" }
```

### Webhooks

Set `webhookUrl` on an app to receive `document.created`, `document.updated`, `document.deleted`, `document.bulk_updated` and `document.bulk_deleted` events. Check the `X-MasterAPI-Signature` header like this:

```js
crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex") === req.headers["x-masterapi-signature"]
```

## Security notes

- **Keep API keys on servers.** A key in browser code can be read by anyone. If you must call from a browser, set `allowedOrigins` on the app. Note that this only stops other websites, not scripts. A key in browser code also gives full access to `/auth/users`.
- Each app has a per-minute rate limit (`X-RateLimit-*` headers; `429` when exceeded).
- Old clients using `/api/data/:collection` still work. New code should use `/api/v1`.

## Layout

```
index.js            starts the server
src/config.js       environment settings
src/app.js          Express app and routing
src/lib/            storage (MongoDB / JSON), query language, keys & tokens, middleware, webhooks
src/routes/         admin, data, users, services (kv, counters, AI)
public/index.html   the console (single page, no build step)
render.yaml         Render Blueprint
test/api.test.js    end-to-end tests
```
