// Document parsing: turns an uploaded PDF, Word (.docx) or text file into plain text.
// The file's real type is decided from its first bytes, not from its name or the header it was sent with.
const { bad, ApiError } = require('./errors');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CHARS = 200000;
const PARSE_TIMEOUT_MS = 25000;
const MAX_UNPACKED = 100 * 1024 * 1024; // guards against "zip bomb" Word files

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new ApiError(422, `${what} took too long to read`)), ms))]);

function sniff(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3 && buf[3] === 4) return 'zip';
  if (buf.subarray(0, 4096).includes(0)) return 'binary';
  return 'text';
}

async function parsePdf(buf) {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const run = async () => {
    const pdf = await getDocumentProxy(new Uint8Array(buf)); // a copy: the reader may take ownership of the bytes
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { pages: totalPages, text: Array.isArray(text) ? text.join('\n') : text };
  };
  try {
    return await withTimeout(run(), PARSE_TIMEOUT_MS, 'The PDF');
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(422, 'This PDF could not be read. It may be damaged or password-protected.');
  }
}

async function parseDocx(buf) {
  const JSZip = require('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new ApiError(415, 'This file looks like a zip archive but could not be opened.');
  }
  if (!zip.file('word/document.xml')) throw new ApiError(415, 'This is a zip file, but not a Word document (.docx).');
  let unpacked = 0;
  zip.forEach((_p, f) => { unpacked += f._data?.uncompressedSize || 0; });
  if (unpacked > MAX_UNPACKED) throw bad('This Word file is too large once unpacked.');
  const mammoth = require('mammoth');
  try {
    const r = await withTimeout(mammoth.extractRawText({ buffer: buf }), PARSE_TIMEOUT_MS, 'The Word file');
    return { text: r.value, warnings: (r.messages || []).map((m) => m.message).slice(0, 5) };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(422, 'This Word file could not be read.');
  }
}

const clean = (t) =>
  String(t || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

/** Reads a document. Returns { type, pages?, text, chars, truncated, warnings }. */
async function parseDocument(buf, filename = '') {
  if (!Buffer.isBuffer(buf) || !buf.length) throw bad('No file received. Send the file as the request body, or JSON with text or contentBase64.');
  if (buf.length > MAX_BYTES) throw new ApiError(413, `The file is too large (max ${MAX_BYTES / 1024 / 1024} MB).`);
  const kind = sniff(buf);
  let out;
  if (kind === 'pdf') out = { type: 'pdf', ...(await parsePdf(buf)) };
  else if (kind === 'zip') out = { type: 'docx', ...(await parseDocx(buf)) };
  else if (kind === 'text') out = { type: 'text', text: buf.toString('utf8') };
  else throw new ApiError(415, 'Unsupported file. Send a PDF, a Word (.docx) file or plain text.');
  const warnings = out.warnings || [];
  let text = clean(out.text);
  if (!text) warnings.push('No text was found. If this is a scanned image or photo, it has no text to read.');
  const truncated = text.length > MAX_CHARS;
  if (truncated) {
    text = text.slice(0, MAX_CHARS);
    warnings.push(`The text was cut at ${MAX_CHARS.toLocaleString()} characters.`);
  }
  return { filename: String(filename || '').slice(0, 200), type: out.type, ...(out.pages ? { pages: out.pages } : {}), chars: text.length, truncated, warnings, text };
}

module.exports = { parseDocument, sniff, MAX_BYTES };
