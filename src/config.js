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
  hfToken: env.HF_TOKEN || '',
  hfModel: env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
};

if (config.nodeEnv === 'production') {
  for (const k of ['masterKey', 'tokenSecret']) {
    if (!config[k] || config[k].length < 16) {
      console.error(`❌ ${k === 'masterKey' ? 'MASTER_KEY' : 'TOKEN_SECRET'} must be set (16+ characters) in production.`);
      process.exit(1);
    }
  }
}
if (!config.tokenSecret) {
  config.tokenSecret = require('crypto').randomBytes(32).toString('hex');
  console.warn('⚠️  TOKEN_SECRET not set — using a random one; user logins reset on restart.');
}

module.exports = config;
