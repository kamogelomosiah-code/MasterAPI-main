// What "extract" can pull out of a document. Each schema has:
//   shape      - the JSON shape the AI is asked for
//   normalize  - cleans whatever came back into exactly that shape (never trust a model's types)
//   rules      - a simple no-AI fallback that still returns something useful
const CATEGORIES = ['Groceries', 'Transport', 'Bills', 'Eating out', 'Health', 'Shopping', 'Income', 'Savings', 'Fees', 'Other'];

const str = (v, max = 300) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const strList = (v, max, len = 80) => list(v, max).map((x) => str(x, len)).filter(Boolean);

/** "R 1 234,50", "(250.00)", "250.00 DR", "-12.5" -> number (negative for debits). NaN if it is not an amount. */
function amount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? '').trim();
  if (!s) return NaN;
  let neg = /^-/.test(s) || /^\(.*\)$/.test(s) || /\bDR\b/i.test(s);
  s = s.replace(/\b(CR|DR)\b/gi, '').replace(/[()]/g, '').replace(/[A-Za-z$€£]/g, '').replace(/[\s ]/g, '').replace(/^-/, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -Math.abs(n) : n;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function ymd(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate())) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Dates as printed on statements (day first) -> YYYY-MM-DD. Returns '' if it cannot be read. */
function isoDate(s, defaultYear) {
  s = String(s || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return ymd(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) return ymd(m[3].length === 2 ? 2000 + Number(m[3]) : m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?/))) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon && (m[3] || defaultYear)) return ymd(m[3] || defaultYear, mon, m[1]);
  }
  return '';
}

const CATEGORY_WORDS = [
  ['Groceries', /checkers|woolworths|spar\b|pick n pay|shoprite|food lover|grocer|supermarket/i],
  ['Transport', /uber|bolt\b|engen|shell\b|bp\b|sasol|petrol|fuel|gautrain|taxi|toll/i],
  ['Bills', /netflix|spotify|vodacom|mtn\b|telkom|eskom|insurance|rent\b|municipal|dstv|cell c|rain\b|premium/i],
  ['Eating out', /kfc|nando|mcdonald|steers|restaurant|cafe|coffee|pizza|burger|wimpy|uber eats|mr d/i],
  ['Health', /pharmacy|clicks|dis-?chem|doctor|clinic|medical|hospital|dentist/i],
  ['Shopping', /takealot|amazon|mr price|pep\b|ackermans|jet\b|game\b|builders|makro|h&m|zara/i],
  ['Income', /salary|wages|payroll|deposit|refund|interest received|cash deposit/i],
  ['Savings', /savings|transfer to savings|investment|tfsa/i],
  ['Fees', /fee\b|fees\b|charge|service charge|monthly account|commission/i],
];
const guessCategory = (desc) => (CATEGORY_WORDS.find(([, re]) => re.test(desc)) || ['Other'])[0];

// ---------------------------------------------------------------- resume
function normalizeResume(d) {
  d = d && typeof d === 'object' ? d : {};
  return {
    name: str(d.name, 100), email: str(d.email, 160), phone: str(d.phone, 40), location: str(d.location, 100),
    headline: str(d.headline, 160), summary: str(d.summary, 1500),
    skills: strList(d.skills, 60, 60),
    experience: list(d.experience, 30).map((e) => ({
      title: str(e?.title, 120), company: str(e?.company, 120), start: str(e?.start, 30), end: str(e?.end, 30), location: str(e?.location, 100),
      bullets: strList(e?.bullets, 20, 400),
    })).filter((e) => e.title || e.company),
    education: list(d.education, 20).map((e) => ({ school: str(e?.school, 140), qualification: str(e?.qualification, 160), start: str(e?.start, 30), end: str(e?.end, 30) })).filter((e) => e.school || e.qualification),
    links: list(d.links, 15).map((l) => ({ label: str(l?.label, 60), url: str(l?.url, 300) })).filter((l) => /^https?:\/\//i.test(l.url)),
    languages: strList(d.languages, 15, 40),
  };
}

function rulesResume(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
  const phone = (text.match(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)\d{3}[\s-]?\d{3,4}/) || [''])[0];
  const links = [...new Set(text.match(/https?:\/\/[^\s)>\]"']+/g) || [])].slice(0, 10).map((url) => ({ label: new URL(url).hostname.replace(/^www\./, ''), url }));
  const first = lines.find((l) => /^[A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(l) && !/curriculum|resume|cv/i.test(l)) || '';
  let skills = [];
  const si = lines.findIndex((l) => /^(technical\s+)?skills\b/i.test(l));
  if (si >= 0) {
    const chunk = [];
    for (const l of lines.slice(si + 1)) { if (/^[A-Z][A-Za-z &/]{2,30}:?$/.test(l) && l === l.toUpperCase()) break; chunk.push(l); if (chunk.length > 8) break; }
    skills = chunk.join(',').split(/[,•·|;]/).map((s) => s.replace(/^[-–*\s]+/, '').trim()).filter((s) => s && s.length < 50).slice(0, 40);
  }
  return normalizeResume({ name: first, email, phone, links, skills });
}

// ---------------------------------------------------------------- bank statement
function normalizeStatement(d, ctx = {}) {
  d = d && typeof d === 'object' ? d : {};
  const year = ctx.year;
  const tx = list(d.transactions, 1000).map((t) => {
    const description = str(t?.description, 120);
    const amt = amount(t?.amount);
    const category = CATEGORIES.includes(t?.category) ? t.category : guessCategory(description);
    return { date: isoDate(t?.date, year), description, amount: Number.isFinite(amt) ? Math.round(amt * 100) / 100 : NaN, category };
  }).filter((t) => t.description && Number.isFinite(t.amount));
  const bal = (v) => { const n = amount(v); return Number.isFinite(n) ? n : null; };
  return { currency: str(d.currency, 8), openingBalance: bal(d.openingBalance), closingBalance: bal(d.closingBalance), transactions: tx };
}

function rulesStatement(text) {
  const year = (text.match(/\b(20\d{2})\b/) || [])[1];
  const money = String.raw`-?\(?R?\s?\d[\d\s,]*[.,]\d{2}\)?(?:\s?(?:CR|DR|Cr|Dr))?`;
  const re = new RegExp(String.raw`^(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?)\s+(.+?)\s+(${money})(?:\s+${money})?\s*$`);
  const transactions = [];
  for (const raw of text.split('\n')) {
    const m = raw.trim().match(re);
    if (m) transactions.push({ date: m[1], description: m[2], amount: m[3] });
  }
  return normalizeStatement({ transactions }, { year });
}

// ---------------------------------------------------------------- receipt
function normalizeReceipt(d) {
  d = d && typeof d === 'object' ? d : {};
  const total = amount(d.total);
  return {
    merchant: str(d.merchant, 120), date: isoDate(d.date) || str(d.date, 20), currency: str(d.currency, 8), total: Number.isFinite(total) ? total : null,
    items: list(d.items, 100).map((i) => ({ name: str(i?.name, 120), quantity: Number.isFinite(Number(i?.quantity)) ? Number(i.quantity) : 1, price: Number.isFinite(amount(i?.price)) ? amount(i.price) : null })).filter((i) => i.name),
  };
}
function rulesReceipt(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const totalLine = [...lines].reverse().find((l) => /\btotal\b/i.test(l) && !/sub\s*total/i.test(l));
  const t = totalLine && (totalLine.match(/-?[\d\s]*[\d][.,]\d{2}/) || [])[0];
  const date = (text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})\b/) || [''])[0];
  return normalizeReceipt({ merchant: lines[0] || '', date, total: t });
}

const SCHEMAS = {
  resume: {
    about: 'A resume or CV: contact details, summary, skills, experience, education, links.',
    shape: `{
  "name": "string", "email": "string", "phone": "string", "location": "string",
  "headline": "string (their job title or a one-line summary)", "summary": "string",
  "skills": ["string"],
  "experience": [{ "title": "string", "company": "string", "start": "string (e.g. 2021-03 or 2021)", "end": "string (or Present)", "location": "string", "bullets": ["string"] }],
  "education": [{ "school": "string", "qualification": "string", "start": "string", "end": "string" }],
  "links": [{ "label": "string", "url": "string (full https:// address)" }],
  "languages": ["string"]
}`,
    normalize: normalizeResume, rules: rulesResume, chunk: false,
  },
  statement: {
    about: 'A bank or card statement: every transaction with date, description and signed amount.',
    shape: `{
  "currency": "string (for example ZAR)", "openingBalance": "number or null", "closingBalance": "number or null",
  "transactions": [{ "date": "YYYY-MM-DD", "description": "string", "amount": "number (money in is positive, money out is negative)", "category": "one of: ${CATEGORIES.join(', ')}" }]
}`,
    normalize: normalizeStatement, rules: rulesStatement, chunk: true,
  },
  receipt: {
    about: 'A shop receipt or invoice: merchant, date, total and line items.',
    shape: `{ "merchant": "string", "date": "YYYY-MM-DD", "currency": "string", "total": "number", "items": [{ "name": "string", "quantity": "number", "price": "number" }] }`,
    normalize: normalizeReceipt, rules: rulesReceipt, chunk: false,
  },
};

/** A schema made from a plain list of field names, for anything else: { fields: ["invoice_number", "due_date"] }. */
function customSchema(fields) {
  const names = [...new Set(fields.map((f) => String(f).trim()))];
  const shape = '{ ' + names.map((n) => `"${n}": "string"`).join(', ') + ' }';
  const normalize = (d) => Object.fromEntries(names.map((n) => [n, str(d && d[n], 500)]));
  return { about: 'Custom fields', shape, normalize, rules: () => normalize({}), chunk: false };
}

module.exports = { SCHEMAS, CATEGORIES, customSchema, amount, isoDate, guessCategory, str };
