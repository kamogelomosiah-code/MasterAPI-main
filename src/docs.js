// Machine-readable endpoint list served at GET /api/docs.
module.exports = {
  name: 'MasterAPI',
  version: '3.0.0',
  description: 'One backend for all your apps: data CRUD, user accounts, key-value storage, counters, webhooks, AI chat and a contact-mail service.',
  auth: {
    apps: 'Send your app key in the X-API-Key header on every /api/v1 request.',
    users: 'After /api/v1/auth/login, also send Authorization: Bearer <token> to act as that user.',
    admin: 'Admin routes need Authorization: Bearer <MASTER_KEY>.',
  },
  endpoints: {
    public: ['GET /api/health', 'GET /api/docs'],
    admin: [
      'GET /api/admin/apps', 'POST /api/admin/apps {name, description?, rateLimitPerMinute?, allowedOrigins?, webhookUrl?}',
      'GET /api/admin/apps/:id', 'PATCH /api/admin/apps/:id', 'POST /api/admin/apps/:id/rotate-key', 'DELETE /api/admin/apps/:id?purge=true',
    ],
    app: ['GET /api/v1/me'],
    data: [
      'GET /api/v1/data — your collections',
      'GET /api/v1/data/:collection ?limit&page|offset&sort=-createdAt,name&fields=a,b&where={json}&field=value&mine=true',
      'POST /api/v1/data/:collection/query {filter, sort, limit, offset, fields}',
      'GET /api/v1/data/:collection/count',
      'GET /api/v1/data/:collection/:id',
      'POST /api/v1/data/:collection {..} or [{..}, ..] (max 1000)',
      'PATCH /api/v1/data/:collection/:id (merge; null removes a field)',
      'PUT /api/v1/data/:collection/:id (replace)',
      'DELETE /api/v1/data/:collection/:id',
      'PATCH /api/v1/data/:collection {filter, set} — bulk update',
      'DELETE /api/v1/data/:collection {filter} or ?all=true — bulk delete',
    ],
    filterOperators: ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$contains', '$startsWith', '$or', '$and'],
    users: [
      'POST /api/v1/auth/register {email, password, name?, profile?}', 'POST /api/v1/auth/login {email, password}',
      'GET /api/v1/auth/me', 'PATCH /api/v1/auth/me {name?, profile?}', 'POST /api/v1/auth/me/password {currentPassword, newPassword}', 'DELETE /api/v1/auth/me',
      'GET /api/v1/auth/users ?q&limit&offset', 'PATCH /api/v1/auth/users/:id {disabled?, role?, name?, profile?}', 'DELETE /api/v1/auth/users/:id',
    ],
    keyValue: ['GET /api/v1/kv ?prefix', 'GET /api/v1/kv/:key', 'PUT /api/v1/kv/:key {value}', 'DELETE /api/v1/kv/:key'],
    counters: ['GET /api/v1/counters', 'GET /api/v1/counters/:name', 'POST /api/v1/counters/:name/increment {by?}', 'DELETE /api/v1/counters/:name'],
    ai: [
      'GET /api/v1/ai/status — is AI on, and which models',
      'POST /api/v1/ai/chat {prompt | messages, system?, history?, model?, maxTokens?, temperature?} → {reply, model} — tries several Hugging Face models in order',
    ],
    documents: [
      'GET /api/v1/docs/status — what can be parsed and which extraction schemas exist',
      'POST /api/v1/docs/parse — send a PDF, Word (.docx) or text file as the raw body (or JSON {text} / {filename, contentBase64}, up to 10 MB) → {type, pages, chars, text, warnings}',
      'POST /api/v1/docs/extract?schema=resume|statement|receipt (or ?fields=a,b) — same upload, returns {data, method: "ai"|"rules", warnings}; falls back to simple rules when AI is unavailable',
      'POST /api/v1/ai/extract {text, schema | fields} — extraction from text you already have',
    ],
    mail: ['POST /api/v1/mail/contact {name, email, subject?, message} — saves the message (collection contact_messages) and emails the app\'s contact address'],
  },
  webhooks: 'Set webhookUrl on an app to receive POSTs on document.created / updated / deleted. Verify X-MasterAPI-Signature = HMAC-SHA256(body, webhookSecret).',
};
