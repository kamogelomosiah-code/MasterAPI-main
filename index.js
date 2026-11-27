// Starts MasterAPI. All the real code is in src/.
const config = require('./src/config');
const { initStore, getStore } = require('./src/lib/store');
const { createApp } = require('./src/app');

(async () => {
  await initStore();
  const server = createApp().listen(config.port, () => {
    console.log(`🚀 MasterAPI on http://localhost:${config.port}  (docs: /api/docs)`);
    if (!config.masterKey) console.warn('⚠️  MASTER_KEY not set — admin routes are disabled, so you cannot create apps.');
  });
  const stop = async () => {
    server.close();
    await getStore().close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((e) => {
  console.error('❌ Failed to start:', e.message);
  process.exit(1);
});
