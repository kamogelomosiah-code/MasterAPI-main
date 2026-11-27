// Content types: trust a sensible header, else the file name, else the first bytes.
const EXT = {
  json: 'application/json', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html', xml: 'application/xml',
  js: 'text/javascript', css: 'text/css', yaml: 'application/yaml', yml: 'application/yaml', svg: 'image/svg+xml',
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const MAGIC = [[[0x25, 0x50, 0x44, 0x46], 'application/pdf'], [[0x89, 0x50, 0x4e, 0x47], 'image/png'], [[0xff, 0xd8, 0xff], 'image/jpeg'], [[0x47, 0x49, 0x46, 0x38], 'image/gif'], [[0x50, 0x4b, 3, 4], 'application/zip']];

function contentType(header, name, buf) {
  const h = String(header || '').split(';')[0].trim().toLowerCase();
  if (h && h !== 'application/octet-stream' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(h)) return h;
  const ext = /\.([A-Za-z0-9]+)$/.exec(name || '')?.[1]?.toLowerCase();
  if (ext && EXT[ext]) return EXT[ext];
  for (const [sig, type] of MAGIC) if (sig.every((b, i) => buf[i] === b)) return type;
  return 'application/octet-stream';
}
const isJson = (type, name) => type === 'application/json' || type.endsWith('+json') || /\.json$/i.test(name);
// Types a browser may show inside a page without running anything.
const SAFE_INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/(plain|csv|markdown)|application\/json|audio\/|video\/)/;
module.exports = { contentType, isJson, SAFE_INLINE, EXT };
