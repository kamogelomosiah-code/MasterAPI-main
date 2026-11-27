// Sends a signed POST to the app's webhookUrl when its data changes.
// Header X-MasterAPI-Signature = HMAC-SHA256(body, webhookSecret) in hex.
const { hmac } = require('./security');

function fire(app, event, payload) {
  if (!app.webhookUrl) return;
  const body = JSON.stringify({ event, appId: app.id, at: new Date().toISOString(), ...payload });
  fetch(app.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-masterapi-event': event, 'x-masterapi-signature': hmac(app.webhookSecret || '', body) },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch((e) => console.warn(`Webhook to ${app.webhookUrl} failed: ${e.message}`));
}
module.exports = { fire };
