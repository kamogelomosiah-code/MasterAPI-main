# MasterAPI

One backend for all your apps. Each app gets its own API key and its own separate data, with:

- **Data CRUD** – any collection; filter, sort, page, bulk create/update/delete
- **User accounts** – sign-up, log-in, profiles, password change, user management
- **Key-value store** – settings, feature flags, any JSON by key
- **Counters** – atomic increments for views, likes, downloads
- **Webhooks** – signed POSTs to your app when its data changes
- **AI** – text generation via Hugging Face (optional)

Storage is MongoDB when `MONGODB_URI` is set, otherwise a JSON file (for local development).

## Where this project is now (27 Nov 2026)

**Status: v3, the one backend for all my apps.** Suggested GitHub name: `masterapi`.

| | |
|---|---|
| **Services** | **Data** (CRUD on any collection) · **Accounts** (sign-up / log-in per app) · **Settings & counters** · **AI chat** (Hugging Face models with fallbacks) · **Contact mail** (saved, then emailed) · **Webhooks** |
| **Works and tested** | 37 automated end-to-end tests (`npm test`) on the file store. AI and mail are tested against stand-ins for Hugging Face and the email provider: model fallback, slow and refused models, input checks, per-app limits, escaped email, provider failures, and the "not configured" cases. The console and `/try` were checked in a browser |
| **Not yet verified** | Saving to **MongoDB Atlas**, the **real Hugging Face** service (which models your token can use), the **real email provider**, and a live Render deployment. None of these can be reached from where this was built |
| **Used by** | The portfolio (chat, contact form, profile and admin passcode, guestbook, visit counter) and the household budget app (sync) |
| **Next** | Connect the stock manager (real accounts and shared stock), the realtime chat (message history) and the video site |

**Health:** `/api/health` says honestly whether storage is persistent and whether AI and mail are configured. The console shows the same.

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

5. For AI chat, add `HF_TOKEN`. For contact mail, add `RESEND_API_KEY` and `MAIL_TO`. The console's status line shows what is on.

`CORS_ORIGINS` is `*` by default. Change it to your sites (comma-separated) once you know them. In production the server refuses to start without `MASTER_KEY` and `TOKEN_SECRET`, and refuses to start if `MONGODB_URI` is set but unreachable. If `MONGODB_URI` is not set at all, it still runs but keeps data in a file that is **lost on every restart**: it warns in the logs and `/api/health` shows `"persistent": false`. When it is set up properly, `/api/health` says `"storage":"mongodb"`.

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

### Key-value and counters

```
GET/PUT/DELETE /kv/:key        PUT body: { "value": anything }
GET /kv?prefix=feature.
GET /counters/:name            POST /counters/:name/increment  { "by": 1 }
```

### AI chat

```bash
curl -X POST $API/api/v1/ai/chat -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"system":"You are a friendly assistant for my shop.","history":[...],"prompt":"Do you ship abroad?"}'
# → { "reply": "…", "model": "Qwen/Qwen3-4B-Instruct-2507", "ms": 1800 }
```

Send `prompt` (or a `messages` list), an optional `system` prompt and earlier turns in `history`. The server tries the models in order (`HF_MODEL`, `HF_MODELS`, then `Qwen/Qwen3-4B-Instruct-2507`, `Qwen/Qwen2.5-3B-Instruct`, `Qwen/Qwen2.5-7B-Instruct` and `meta-llama/Llama-3.2-3B-Instruct`) and returns the first answer. A model that is missing, slow (25 s) or failing is skipped; a refused token stops at once with a clear message. One request never takes longer than 55 s. Each app gets 20 chats a minute. Only this server holds the Hugging Face token, so your apps never need it. `GET /ai/status` shows whether AI is on and which models are in use.

### Documents: PDF parser and AI extraction

```bash
# Read a PDF / Word file as text (the file is the raw request body)
curl -X POST $API/api/v1/docs/parse -H "X-API-Key: $KEY" -H "X-Filename: cv.pdf" --data-binary @cv.pdf
# Turn it into structured data: schema = resume | statement | receipt, or your own ?fields=invoice_number,due_date
curl -X POST "$API/api/v1/docs/extract?schema=resume" -H "X-API-Key: $KEY" --data-binary @cv.pdf
# → { "data": { "name": "…", "skills": […], "experience": […] }, "method": "ai", "warnings": [] }
```

Files up to 10 MB; the type is detected from the file itself (PDF, `.docx`, text). Scanned PDFs with no text layer are reported with a warning (there is no OCR). Extraction asks the AI service for JSON and cleans the result (dates to `YYYY-MM-DD`, amounts to numbers, bad links dropped). Long bank statements are read in pieces and merged. If AI is off or fails, simple rules still find contact details, links, skills and statement lines, and `method` says `"rules"`. Each app gets `DOCS_PER_MINUTE` (default 20) requests a minute.

### Files: store, read, edit and organise any file

```bash
# Upload any file (the file is the body). Folders are just paths.
curl -X POST "$API/api/v1/files?path=docs/cv.pdf" -H "X-API-Key: $KEY" --data-binary @cv.pdf
# JSON files: send the data, read it back, change one field without re-sending the rest
curl -X POST $API/api/v1/files -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"path":"settings/app.json","json":{"theme":"dark","beta":false}}'
curl -X PATCH "$API/api/v1/files/settings%2Fapp.json/json" -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"beta":true}'
curl "$API/api/v1/files/settings%2Fapp.json/json" -H "X-API-Key: $KEY"
curl "$API/api/v1/files?prefix=docs/" -H "X-API-Key: $KEY"           # list a folder
curl -O -J "$API/api/v1/files/docs%2Fcv.pdf/content" -H "X-API-Key: $KEY"   # download
```

Any type of file, up to 10 MB each (`FILE_MAX_MB`) and 100 MB per app (`FILE_QUOTA_MB`). A file is found by its **id** or by its **path** (write `/` as `%2F` in the URL). Every file records its type (taken from the bytes and the name, not just the header), size, SHA-256 and version. Creating at an existing path gives `409`; `PUT` replaces it and bumps the version; send `If-Match: <sha256>` and a stale write gets `412` instead of silently overwriting someone else's change. `.json` files are checked as valid JSON before they are stored (`422` otherwise); `PATCH …/json` is an RFC 7396 merge-patch. You can rename or move (`PATCH {path}`), tag, copy, and delete a file or a whole folder. Downloads are sent as attachments with a locked-down content policy, so an uploaded HTML file can never run in your API's origin. Bytes live in MongoDB when `MONGODB_URI` is set (they survive Render restarts), otherwise on disk next to the data file. Raw uploads can be 10 MB; the JSON `contentBase64` form is limited to about 3.7 MB by the 5 MB JSON body limit.

### Writing assistant: documents, slides, CVs

```bash
# Rewrite / summarise / translate / review a CV ... text, a stored file (PDF or Word), or a web page
curl -X POST $API/api/v1/ai/write -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"task":"cv-tailor","path":"docs/cv.pdf","instructions":"Job: junior data engineer at a bank"}'
# Analyse anything: summary, key points, people/companies/dates/amounts, sentiment, action items, and an answer
curl -X POST $API/api/v1/ai/analyze -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"url":"https://example.com/report","question":"What changed this year?"}'
# Make a real Word document or PowerPoint deck and store it in Files
curl -X POST $API/api/v1/ai/generate -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"kind":"slides","prompt":"Pitch for a budgeting app for students","slideCount":8,"save":{"path":"decks/pitch.pptx"}}'
```

Tasks for `/ai/write`: `draft, summarize, rewrite, proofread, translate, expand, shorten, bullets, email, minutes, explain, cv-review, cv-tailor, cover-letter` (the CV tasks are told never to invent facts). `/ai/generate` asks the model for a *structure* (headings and paragraphs, or slides and bullets) and then builds a valid `.docx` / `.pptx` / `.md` / `.html` itself, so the file always opens. Use `source` to build from a stored file ("turn this CV into a one-page summary"). `POST /docs/build` makes the same files from a structure you send, with no AI at all. Long input is read in parts and the response says when only part was used.

**The model.** The default is `Qwen/Qwen3-4B-Instruct-2507` (4 billion parameters, Apache-2.0): small, free through Hugging Face, and good at following instructions and writing JSON. If it is busy the server falls back to `Qwen/Qwen2.5-3B-Instruct`, then `Qwen2.5-7B-Instruct` and `Llama-3.2-3B-Instruct`. Change the order with `HF_MODEL` / `HF_MODELS`. Quality is that of a small model: good for drafting, summarising and structuring, not a replacement for proofreading.

### Web access and the automation agent

```bash
curl -X POST $API/api/v1/web/fetch -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"url":"https://example.com"}'
curl -X POST $API/api/v1/agent/run -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"goal":"Read https://example.com/pricing and write a short comparison table to agent/pricing.md","maxSteps":6}'
```

`/web/fetch` returns the readable text, title and links of a web page (also JSON and PDFs). `/web/extract` turns a page into structured fields. `/agent/run` is a small agent: it picks one tool at a time (`web_fetch`, `http_request`, `list_files`, `read_file`, `write_file`, `finish`), sees the result and continues for at most 10 steps and ~85 seconds, then returns the answer and every step it took. Saved goals live under `/automations` (create once, `POST /automations/:id/run` whenever, from a cron service or a webhook). Safety: the web is **read-only** unless a run sets `allowWrites` *and* lists the hosts it may send data to (`allowHosts`); files can only be written inside `agent/`; text from web pages is treated as data, not instructions; private and internal network addresses are blocked on every redirect hop; one run at a time per app, 6 runs a minute. A 4-billion-parameter model is good at simple, well-described tasks (look something up, compare, summarise, fill a file) and will make mistakes on long or ambiguous ones, so check the `steps` it returns.

### Contact mail

```bash
curl -X POST $API/api/v1/mail/contact -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"Jo","email":"jo@example.com","subject":"Hello","message":"Nice site"}'
# → { "ok": true, "saved": true, "emailed": true }
```

The message is **always saved** (collection `contact_messages`) and then emailed to the app's contact address (set it in the console, or use `MAIL_TO` for all apps). If the email provider fails you still get `saved: true`, `emailed: false` and a `note`. The email escapes whatever the visitor typed. It sends through Resend over HTTPS, because Render's free plan blocks SMTP. Each app is limited to 30 messages an hour.

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
