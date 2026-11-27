// A tiny in-memory fixed-window limiter: allow(key) returns false once `max` calls happen inside `windowMs`.
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const w = hits.get(key);
    if (!w || w.until < now) {
      hits.set(key, { n: 1, until: now + windowMs });
      if (hits.size > 5000) hits.delete(hits.keys().next().value);
      return true;
    }
    w.n++;
    return w.n <= max;
  };
}
module.exports = { limiter };
