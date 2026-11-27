// Mail service: sends email through Resend's HTTPS API (SMTP is blocked on Render's free plan).
const config = require('../config');

const enabled = () => Boolean(config.resendKey);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function send({ to, replyTo, subject, text, html }) {
  const r = await fetch(config.resendUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.mailFrom, to: [to], reply_to: replyTo, subject, text, html }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`Mail provider answered HTTP ${r.status}`);
  return true;
}

/** The email an owner gets when someone uses a contact form. Visitor text is escaped. */
function contactEmail({ name, email, subject, message, appName }) {
  const subj = `[${appName}] ${subject || 'New message'} from ${name}`.slice(0, 200);
  const text = `From: ${name} <${email}>\nSubject: ${subject || 'N/A'}\n\n${message}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;padding:20px;border:1px solid #e2e8f0;border-radius:14px">
<h2 style="margin:0 0 12px;font-size:18px">New message from ${esc(appName)}</h2>
<p style="margin:4px 0"><b>Name:</b> ${esc(name)}</p>
<p style="margin:4px 0"><b>Email:</b> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
<p style="margin:4px 0"><b>Subject:</b> ${esc(subject || 'N/A')}</p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:14px 0">
<div style="white-space:pre-wrap;line-height:1.6">${esc(message)}</div></div>`;
  return { subject: subj, text, html };
}

module.exports = { enabled, send, contactEmail, esc };
