// Pulls the first JSON object out of a model's reply, which may be wrapped in words or code fences.
function extractJson(text) {
  const cleaned = String(text || '').replace(/```(json)?/gi, '');
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(cleaned.slice(a, b + 1));
  } catch {
    return null;
  }
}
module.exports = { extractJson };
