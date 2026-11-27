// Mail service. POST /api/v1/mail/contact { name, email, subject?, message }
// The message is always saved (collection "contact_messages"); it is also emailed to the app's contact address.
const router = require('express').Router();
const { ah, bad, ApiError } = require('../lib/errors');
const mail = require('../lib/mail');
const config = require('../config');
const { limiter } = require('../lib/limits');
const { getStore, newId, now } = require('../lib/store');

const allow = limiter(config.mailPerHour, 3600e3);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v, name, max, required) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && required) throw bad(`${name} is required`);
  if (s.length > max) throw bad(`${name} must be ${max} characters or fewer`);
  return s;
};

router.post('/mail/contact', ah(async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 'name', 100, true);
  const email = text(b.email, 'email', 255, true);
  if (!EMAIL.test(email)) throw bad('A valid email address is required');
  const subject = text(b.subject, 'subject', 200, false);
  const message = text(b.message, 'message', 5000, true);
  if (!allow(req.client.id)) {
    res.set('Retry-After', '600');
    throw new ApiError(429, 'Too many messages. Please try again later.');
  }

  const ns = `app:${req.client.id}:contact_messages`;
  const doc = { id: newId(), name, email, subject, message, read: false, emailed: false, createdAt: now(), updatedAt: now() };
  await getStore().insert(ns, [doc]);

  const to = req.client.contactEmail || config.mailTo;
  let note = '';
  if (!mail.enabled()) note = 'Email is not configured on this server (set RESEND_API_KEY). The message was saved.';
  else if (!to) note = 'No contact email is set for this app (set MAIL_TO). The message was saved.';
  else {
    try {
      await mail.send({ to, replyTo: email, ...mail.contactEmail({ name, email, subject, message, appName: req.client.name }) });
      doc.emailed = true;
      await getStore().update(ns, { id: doc.id }, { emailed: true });
    } catch (e) {
      note = `${e.name === 'TimeoutError' ? 'The mail provider timed out' : e.message}. The message was saved.`;
    }
  }
  res.status(201).json({ ok: true, id: doc.id, saved: true, emailed: doc.emailed, ...(note ? { note } : {}) });
}));

module.exports = router;
