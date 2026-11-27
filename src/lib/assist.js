// Document assistant: write / rewrite / summarise, analyse content, and generate documents and slide decks.
// The AI drafts; the files are built by build.js, so a deck or document is always valid.
const ai = require('./ai');
const files = require('./files');
const { parseDocument } = require('./docs');
const { readPage } = require('./web');
const { extractJson } = require('./json');
const { build, normalizeDocument, normalizeSlides } = require('./build');
const { bad, ApiError } = require('./errors');

const MAX_INPUT = 60000;       // characters accepted
const READ_LIMIT = 12000;      // characters sent to the model in one go

/** The text to work on: { text }, { fileId | path } (a stored file) or { url }. */
async function inputText(appId, b, { required = true } = {}) {
  let text = '', from = null;
  if (typeof b.text === 'string' && b.text.trim()) { text = b.text; from = 'text'; }
  else if (b.fileId || b.path) {
    const { meta, buf } = await files.read(appId, String(b.fileId || b.path));
    const d = await parseDocument(buf, meta.name).catch((e) => { if (e.status === 415) return { text: buf.toString('utf8') }; throw e; });
    text = d.text; from = `file:${meta.path}`;
    if (!text.trim()) throw new ApiError(422, 'No text was found in that file.');
  } else if (b.url) {
    const p = await readPage(String(b.url));
    if (p.error) throw new ApiError(502, p.error);
    text = p.text; from = `url:${p.url}`;
  }
  if (!text.trim()) { if (required) throw bad('Send { text }, { fileId } (a stored file) or { url }'); return { text: '', from: null, warnings: [] }; }
  const warnings = [];
  if (text.length > MAX_INPUT) { text = text.slice(0, MAX_INPUT); warnings.push(`Only the first ${MAX_INPUT.toLocaleString('en')} characters were used.`); }
  return { text, from, warnings };
}

const TASKS = {
  draft: ['Write the document the user describes. Use clear headings and short paragraphs.', false],
  summarize: ['Summarise the text. Keep every important fact, number, name and date. Use a short paragraph, then bullet points for key details.', true],
  rewrite: ['Rewrite the text so it is clearer and better written, keeping the same meaning and facts.', true],
  proofread: ['Correct spelling, grammar and punctuation. Change nothing else. Return the full corrected text only.', true],
  translate: ['Translate the text into the requested language. Keep the formatting. Return only the translation.', true],
  expand: ['Expand the text with more detail and examples, staying true to what it says.', true],
  shorten: ['Make the text much shorter, keeping the key points.', true],
  bullets: ['Turn the text into a clear bullet-point list.', true],
  email: ['Write a professional email based on the instructions and any text provided. Include a subject line.', false],
  minutes: ['Turn these meeting notes into minutes: attendees (if named), decisions, action items with owners, next steps.', true],
  explain: ['Explain the text in plain, simple language.', true],
  'cv-review': ['You are a careful recruiter. Review this CV: what is strong, what is missing or weak, and concrete fixes. Be specific and honest. Use short sections.', true],
  'cv-tailor': ['Rewrite this CV so it fits the job description (in the instructions). Keep every fact true: never invent jobs, skills, dates or qualifications. Reorder and reword for relevance. Return the full CV text.', true],
  'cover-letter': ['Write a short, specific cover letter (under 250 words) using the CV text and the job described in the instructions. Never invent facts.', true],
};
const TASK_NAMES = Object.keys(TASKS);

async function write(b) {
  const task = b.task;
  if (!TASKS[task]) throw bad(`task must be one of: ${TASK_NAMES.join(', ')}`);
  const [rule, needsText] = TASKS[task];
  const text = b._text || '';
  const instr = typeof b.instructions === 'string' ? b.instructions.trim().slice(0, 3000) : '';
  if (needsText && !text) throw bad(`"${task}" needs text to work on: send { text }, { fileId } or { url }`);
  if (!needsText && !text && !instr) throw bad(`"${task}" needs { instructions } describing what to write`);
  if (task === 'translate' && !(b.language || instr)) throw bad('translate needs { language }, for example "French"');
  const warnings = [...(b._warnings || [])];
  let body = text;
  if (body.length > READ_LIMIT) { body = body.slice(0, READ_LIMIT); warnings.push(`Only the first ${READ_LIMIT.toLocaleString('en')} characters were read.`); }
  const sys = `You are a careful writing assistant. ${rule}${b.tone ? ` Tone: ${String(b.tone).slice(0, 40)}.` : ''}${b.language && task !== 'translate' ? ` Write in ${String(b.language).slice(0, 40)}.` : ''}${task === 'translate' ? ` Target language: ${String(b.language || '').slice(0, 40)}.` : ''} Never invent facts that are not given. Reply with the result only, no preface.`;
  const user = [instr && `Instructions: ${instr}`, body && `Text:\n"""\n${body}\n"""`].filter(Boolean).join('\n\n');
  const out = await ai.chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], models: ai.pickModels(b.model), maxTokens: Math.min(1800, Number(b.maxTokens) || 1200), temperature: task === 'proofread' || task === 'translate' ? 0.1 : 0.5 });
  return { task, text: out.reply, model: out.model, warnings };
}

const ANALYZE_SHAPE = `{"summary": "2-4 sentences", "keyPoints": ["..."], "topics": ["..."], "sentiment": "positive|neutral|negative", "language": "English", "entities": {"people": [], "organizations": [], "places": [], "dates": [], "amounts": []}, "actionItems": ["things someone should do"], "answer": "answer to the question, or empty if none was asked"}`;
const arr = (v, n = 15) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, n) : []);

async function askStructured(sys, user, models, maxTokens) {
  for (let i = 0; i < 2; i++) {
    const out = await ai.chat({ messages: [{ role: 'system', content: sys + (i ? '\nYour last answer was not valid JSON. Answer again with ONLY the JSON object.' : '') }, { role: 'user', content: user }], models, maxTokens, temperature: 0.1 });
    const obj = extractJson(out.reply);
    if (obj) return { obj, model: out.model };
  }
  throw new ApiError(502, 'The AI answered in a form that could not be read');
}

async function analyze(b) {
  const text = b._text;
  const question = typeof b.question === 'string' ? b.question.trim().slice(0, 500) : '';
  const models = ai.pickModels(b.model);
  const warnings = [...(b._warnings || [])];
  let material = text;
  if (text.length > READ_LIMIT) {
    // Long content: summarise each piece first, then analyse the summaries.
    const pieces = [];
    for (let i = 0; i < text.length && pieces.length < 5; i += 9000) pieces.push(text.slice(i, i + 9000));
    const sums = [];
    for (const p of pieces) {
      const o = await ai.chat({ messages: [{ role: 'system', content: 'Summarise this part of a longer text in under 150 words. Keep names, dates, numbers and decisions.' }, { role: 'user', content: p }], models, maxTokens: 350, temperature: 0.1 });
      sums.push(o.reply);
    }
    material = sums.map((s, i) => `Part ${i + 1}: ${s}`).join('\n\n');
    warnings.push(`This is long, so it was read in ${pieces.length} parts and summarised first${text.length > pieces.length * 9000 ? ` (only the first ${(pieces.length * 9000).toLocaleString('en')} characters)` : ''}.`);
  }
  const sys = `You analyse content and return ONLY one JSON object in exactly this shape, no other text. Use [] or "" when unknown. Never invent facts.\n${ANALYZE_SHAPE}`;
  const { obj, model } = await askStructured(sys, `${question ? `Question to answer: ${question}\n\n` : ''}Content:\n"""\n${material}\n"""`, models, 900);
  const s = ['positive', 'neutral', 'negative'].includes(obj.sentiment) ? obj.sentiment : 'neutral';
  const e = obj.entities && typeof obj.entities === 'object' ? obj.entities : {};
  return {
    data: { summary: String(obj.summary || '').trim(), keyPoints: arr(obj.keyPoints), topics: arr(obj.topics, 10), sentiment: s, language: String(obj.language || '').trim(), entities: { people: arr(e.people), organizations: arr(e.organizations), places: arr(e.places), dates: arr(e.dates), amounts: arr(e.amounts) }, actionItems: arr(obj.actionItems), answer: question ? String(obj.answer || '').trim() : '' },
    model, warnings,
  };
}

const DOC_SHAPE = `{"title": "...", "subtitle": "", "sections": [{"heading": "...", "paragraphs": ["..."], "bullets": ["..."]}]}`;
const slideShape = (n) => `{"title": "deck title", "subtitle": "", "slides": [{"title": "short slide title", "bullets": ["3 to 5 short points"], "notes": "what to say"}]}  (exactly ${n} content slides)`;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'document';

/** Asks the AI for a structure, builds the real file and stores it. */
async function generate(appId, b) {
  const kind = b.kind;
  if (kind !== 'document' && kind !== 'slides') throw bad('kind must be "document" or "slides"');
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) throw bad('prompt is required: describe what to create');
  if (prompt.length > 4000) throw bad('prompt is too long (max 4000 characters)');
  const format = b.format || (kind === 'slides' ? 'pptx' : 'docx');
  const count = Math.min(20, Math.max(3, Number(b.slideCount) || 8));
  const warnings = [];
  const src = await inputText(appId, b.source || {}, { required: false });
  warnings.push(...src.warnings);
  const sys = `You create ${kind === 'slides' ? 'slide decks' : 'documents'}. Reply with ONLY one JSON object in exactly this shape, no other text:\n${kind === 'slides' ? slideShape(count) : DOC_SHAPE}\nBe concrete and useful. Keep bullet points short. Use only facts from the user's request and source; never invent names, numbers or credentials.${b.tone ? ` Tone: ${String(b.tone).slice(0, 40)}.` : ''}${b.language ? ` Write in ${String(b.language).slice(0, 40)}.` : ''}`;
  const user = `Request: ${prompt}${src.text ? `\n\nSource material:\n"""\n${src.text.slice(0, READ_LIMIT)}\n"""` : ''}`;
  if (src.text.length > READ_LIMIT) warnings.push(`Only the first ${READ_LIMIT.toLocaleString('en')} characters of the source were read.`);
  const { obj, model } = await askStructured(sys, user, ai.pickModels(b.model), 2200);
  let built;
  try { built = await build(kind, format, obj); } catch (e) { throw e.status === 400 ? new ApiError(e.message.includes('format') ? 400 : 502, e.message.includes('format') ? e.message : 'The AI did not produce usable content. Please try again.') : e; }
  return finish(appId, b, built, kind, model, warnings);
}

/** Stores a built file (or returns it inline when save is false). */
async function finish(appId, b, built, kind, model, warnings) {
  const base = (b.save && typeof b.save === 'object' && b.save.path) || null;
  if (b.save === false) return { kind, format: built.ext, structure: built.structure, contentBase64: built.buffer.toString('base64'), type: built.type, model, warnings };
  let p = base ? files.cleanPath(base) : `generated/${slug(built.structure.title)}.${built.ext}`;
  let saved;
  const overwrite = Boolean(base && b.save.overwrite);
  for (let i = 2; ; i++) {
    try { saved = await files.save(appId, p, built.buffer, { overwrite, headerType: built.type }); break; } catch (e) {
      if (e.status === 409 && !base && i < 50) { p = `generated/${slug(built.structure.title)}-${i}.${built.ext}`; continue; }
      throw e;
    }
  }
  return { kind, format: built.ext, file: saved.file, download: `/api/v1/files/${saved.file.id}/content`, structure: built.structure, model, warnings };
}

module.exports = { inputText, write, analyze, generate, finish, TASK_NAMES, normalizeDocument, normalizeSlides, slug };
