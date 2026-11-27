// All settings come from environment variables (see .env.example).
require('dotenv').config();

const env = process.env;
const config = {
  port: Number(env.PORT) || 3000,
  nodeEnv: env.NODE_ENV || 'development',
  /** Admin key for managing apps. Required in production. */
  masterKey: env.MASTER_KEY || '',
  /** Secret used to sign end-user login tokens. */
  tokenSecret: env.TOKEN_SECRET || env.MASTER_KEY || '',
  tokenTtlHours: Number(env.TOKEN_TTL_HOURS) || 24 * 7,
  mongoUri: env.MONGODB_URI || '',
  mongoDb: env.MONGODB_DB || 'masterapi',
  dataFile: env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'store.json'),
  /** Comma-separated list of allowed browser origins, or * for any. */
  corsOrigins: (env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  defaultRateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 120,
  version: require('../package.json').version,

  // --- AI service (Hugging Face) ---
  hfToken: env.HF_TOKEN || '',
  hfUrl: env.HF_API_URL || 'https://router.huggingface.co/v1/chat/completions',
  /** Models tried in order: HF_MODEL first, then HF_MODELS (comma-separated), then these defaults. */
  // Small, free, good at following instructions and writing JSON (Apache-2.0): Qwen3 4B first, then smaller/larger Qwen and Llama as fallbacks.
  hfModels: [env.HF_MODEL, ...(env.HF_MODELS || '').split(','), 'Qwen/Qwen3-4B-Instruct-2507', 'Qwen/Qwen2.5-3B-Instruct', 'Qwen/Qwen2.5-7B-Instruct', 'meta-llama/Llama-3.2-3B-Instruct']
    .map((m) => (m || '').trim()).filter((m, i, all) => m && all.indexOf(m) === i),
  hfTimeoutMs: Number(env.HF_TIMEOUT_MS) || 25000,
  /** Total time one chat request may take across all models. */
  aiDeadlineMs: Number(env.AI_DEADLINE_MS) || 55000,
  aiPerMinute: Number(env.AI_PER_MINUTE) || 20,
  docsPerMinute: Number(env.DOCS_PER_MINUTE) || 20,
  writePerMinute: Number(env.WRITE_PER_MINUTE) || 15,

  // --- File storage ---
  fileMaxBytes: Math.round(Number(env.FILE_MAX_MB || 10) * 1024 * 1024),
  fileQuotaBytes: Math.round(Number(env.FILE_QUOTA_MB || 100) * 1024 * 1024),
  fileMaxCount: Number(env.FILE_MAX_COUNT) || 2000,

  // --- Web access and automation agent ---
  webPerMinute: Number(env.WEB_PER_MINUTE) || 30,
  agentPerMinute: Number(env.AGENT_PER_MINUTE) || 6,
  agentDeadlineMs: Number(env.AGENT_DEADLINE_MS) || 85000,

  // --- Mail service (Resend, over HTTPS: works on Render's free plan, which blocks SMTP) ---
  resendKey: env.RESEND_API_KEY || '',
  resendUrl: env.RESEND_API_URL || 'https://api.resend.com/emails',
  mailFrom: env.MAIL_FROM || 'MasterAPI <onboarding@resend.dev>',
  /** Where contact messages are emailed unless an app has its own contactEmail. */
  mailTo: env.MAIL_TO || '',
  mailPerHour: Number(env.MAIL_PER_HOUR) || 30,
};

if (config.nodeEnv === 'production') {
  for (const k of ['masterKey', 'tokenSecret']) {
    if (!config[k] || config[k].length < 16) {
      console.error(`❌ ${k === 'masterKey' ? 'MASTER_KEY' : 'TOKEN_SECRET'} must be set (16+ characters) in production.`);
      process.exit(1);
    }
  }
}
// Data in a file disappears when a host like Render restarts. Say so loudly instead of failing quietly.
config.warnings = [];
if (config.nodeEnv === 'production' && !config.mongoUri) {
  config.warnings.push('MONGODB_URI is not set: data is kept in a file and will be LOST when the server restarts.');
  console.error(`⚠️  ${config.warnings[0]}`);
}
if (!config.tokenSecret) {
  config.tokenSecret = require('crypto').randomBytes(32).toString('hex');
  console.warn('⚠️  TOKEN_SECRET not set — using a random one; user logins reset on restart.');
}

module.exports = config;
