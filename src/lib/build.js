// Builds real files from structured content, with no AI involved: Word (.docx), PowerPoint (.pptx),
// Markdown, HTML and text. Only the zip library is needed; the XML is written by hand.
const JSZip = require('jszip');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const str = (v, max = 4000) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
const list = (v, max = 60) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, max) : []);

// ---------- Structures (what the AI or the caller provides) ----------

/** { title, subtitle?, sections: [{ heading, paragraphs[], bullets[] }] }, cleaned and bounded. */
function normalizeDocument(d) {
  d = d && typeof d === 'object' ? d : {};
  const sections = (Array.isArray(d.sections) ? d.sections : []).slice(0, 60).map((s) => ({
    heading: str(s?.heading, 200), paragraphs: list(s?.paragraphs, 80), bullets: list(s?.bullets, 80),
  })).filter((s) => s.heading || s.paragraphs.length || s.bullets.length);
  const out = { title: str(d.title, 200) || 'Untitled document', subtitle: str(d.subtitle, 300), sections };
  if (!sections.length && !out.subtitle) throw Object.assign(new Error('The document has no content'), { status: 400 });
  return out;
}
/** { title, subtitle?, slides: [{ title, bullets[], notes? }] } */
function normalizeSlides(d) {
  d = d && typeof d === 'object' ? d : {};
  const slides = (Array.isArray(d.slides) ? d.slides : []).slice(0, 60).map((s) => ({
    title: str(s?.title, 150), bullets: list(s?.bullets, 8).map((b) => b.slice(0, 300)), notes: str(s?.notes, 1500),
  })).filter((s) => s.title || s.bullets.length);
  if (!slides.length) throw Object.assign(new Error('The deck has no slides'), { status: 400 });
  return { title: str(d.title, 200) || slides[0].title || 'Presentation', subtitle: str(d.subtitle, 300), slides };
}

// ---------- Word ----------
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text, style, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const bulletP = (text) => para(text, 'ListParagraph', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');

async function toDocx(doc) {
  const body = [para(doc.title, 'Title')];
  if (doc.subtitle) body.push(para(doc.subtitle, 'Subtitle'));
  for (const s of doc.sections) {
    if (s.heading) body.push(para(s.heading, 'Heading1'));
    for (const p of s.paragraphs) body.push(para(p));
    for (const b of s.bullets) body.push(bulletP(b));
  }
  const z = new JSZip();
  z.file('[Content_Types].xml', XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  z.file('_rels/.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>');
  z.file('word/document.xml', `${XML}<w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  const style = (id, name, rpr, ppr = '', based = 'Normal') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/><w:next w:val="Normal"/><w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
  z.file('word/styles.xml', `${XML}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
    + style('Title', 'Title', '<w:b/><w:sz w:val="52"/><w:color w:val="1F2937"/>', '<w:spacing w:after="80"/>')
    + style('Subtitle', 'Subtitle', '<w:sz w:val="26"/><w:color w:val="6B7280"/>', '<w:spacing w:after="240"/>')
    + style('Heading1', 'heading 1', '<w:b/><w:sz w:val="30"/><w:color w:val="DC2626"/>', '<w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/>')
    + style('ListParagraph', 'List Paragraph', '', '<w:spacing w:after="60"/><w:ind w:left="720"/>')
    + '</w:styles>');
  z.file('word/numbering.xml', `${XML}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------- PowerPoint ----------
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const RELNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const emu = (inch) => Math.round(inch * 914400);
const xfrm = (x, y, w, h) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
const run = (t, sz, color, bold) => `<a:r><a:rPr lang="en-US" sz="${sz}"${bold ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${esc(t)}</a:t></a:r>`;
const shape = (id, name, ph, box, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${box}</p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
const slideXml = (inner, bg) => `${XML}<p:sld ${A}><p:cSld>${bg ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` : ''}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

function titleSlide(deck) {
  const t = shape(2, 'Title', '<p:ph type="ctrTitle"/>', xfrm(0.9, 2.3, 11.5, 1.6), `<a:p><a:pPr algn="l"/>${run(deck.title, 4400, 'FFFFFF', true)}</a:p>`);
  const s = deck.subtitle ? shape(3, 'Subtitle', '<p:ph type="subTitle" idx="1"/>', xfrm(0.9, 4.0, 11.5, 1.2), `<a:p><a:pPr algn="l"/>${run(deck.subtitle, 2200, 'D1D5DB')}</a:p>`) : '';
  return slideXml(t + s, '1F2937');
}
function contentSlide(s) {
  const title = shape(2, 'Title', '<p:ph type="title"/>', xfrm(0.7, 0.45, 11.9, 1.1), `<a:p>${run(s.title, 3200, 'DC2626', true)}</a:p>`);
  const paras = (s.bullets.length ? s.bullets : ['']).map((b) => `<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:spcBef><a:spcPts val="900"/></a:spcBef></a:pPr>${run(b, s.bullets.length > 5 ? 2000 : 2400, '1F2937')}</a:p>`).join('');
  const body = shape(3, 'Content', '<p:ph idx="1"/>', xfrm(0.7, 1.7, 11.9, 5.0), paras);
  return slideXml(title + body, 'FFFFFF');
}

async function toPptx(deck) {
  const slides = [titleSlide(deck), ...deck.slides.map(contentSlide)];
  const z = new JSZip();
  const n = slides.length;
  z.file('[Content_Types].xml', XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>');
  z.file('_rels/.rels', XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELNS}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  z.file('ppt/presentation.xml', `${XML}<p:presentation ${A}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  z.file('ppt/_rels/presentation.xml.rels', XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELNS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${RELNS}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 2}" Type="${RELNS}/theme" Target="theme/theme1.xml"/></Relationships>`);
  const empty = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>';
  z.file('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${A}>${empty}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  z.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELNS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${RELNS}/theme" Target="../theme/theme1.xml"/></Relationships>`);
  z.file('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${A} type="blank" preserve="1">${empty}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  z.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELNS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  const clr = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  const fonts = '<a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/>';
  z.file('ppt/theme/theme1.xml', `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="MasterAPI"><a:themeElements><a:clrScheme name="MasterAPI">${clr('dk1', '1F2937')}${clr('lt1', 'FFFFFF')}${clr('dk2', '374151')}${clr('lt2', 'F3F4F6')}${clr('accent1', 'DC2626')}${clr('accent2', '2563EB')}${clr('accent3', '059669')}${clr('accent4', 'D97706')}${clr('accent5', '7C3AED')}${clr('accent6', '0891B2')}${clr('hlink', '2563EB')}${clr('folHlink', '7C3AED')}</a:clrScheme><a:fontScheme name="MasterAPI"><a:majorFont>${fonts}</a:majorFont><a:minorFont>${fonts}</a:minorFont></a:fontScheme><a:fmtScheme name="MasterAPI"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="28575"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`);
  slides.forEach((x, i) => {
    z.file(`ppt/slides/slide${i + 1}.xml`, x);
    z.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELNS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`);
  });
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------- Text formats ----------
const docMarkdown = (d) => [`# ${d.title}`, d.subtitle && `_${d.subtitle}_`, ...d.sections.flatMap((s) => [s.heading && `## ${s.heading}`, ...s.paragraphs, s.bullets.map((b) => `- ${b}`).join('\n')])].filter(Boolean).join('\n\n') + '\n';
const docText = (d) => [d.title, d.subtitle, ...d.sections.flatMap((s) => [s.heading && `${s.heading.toUpperCase()}`, ...s.paragraphs, s.bullets.map((b) => `- ${b}`).join('\n')])].filter(Boolean).join('\n\n') + '\n';
const docHtml = (d) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f2937}h1{margin-bottom:.2rem}h2{color:#dc2626}</style></head><body><h1>${esc(d.title)}</h1>${d.subtitle ? `<p><em>${esc(d.subtitle)}</em></p>` : ''}${d.sections.map((s) => (s.heading ? `<h2>${esc(s.heading)}</h2>` : '') + s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('') + (s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '')).join('')}</body></html>\n`;
const slidesMarkdown = (d) => [`# ${d.title}`, d.subtitle && `_${d.subtitle}_`, ...d.slides.map((s, i) => `---\n\n## ${i + 1}. ${s.title}\n\n${s.bullets.map((b) => `- ${b}`).join('\n')}${s.notes ? `\n\n> Notes: ${s.notes}` : ''}`)].filter(Boolean).join('\n\n') + '\n';

const TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown', html: 'text/html', txt: 'text/plain',
};
const DOC_FORMATS = ['docx', 'md', 'html', 'txt'];
const SLIDE_FORMATS = ['pptx', 'md'];

/** kind: "document" | "slides". Returns { buffer, type, ext, structure }. */
async function build(kind, format, structure) {
  if (kind === 'document') {
    if (!DOC_FORMATS.includes(format)) throw Object.assign(new Error(`format must be one of: ${DOC_FORMATS.join(', ')}`), { status: 400 });
    const d = normalizeDocument(structure);
    const buffer = format === 'docx' ? await toDocx(d) : Buffer.from(format === 'md' ? docMarkdown(d) : format === 'html' ? docHtml(d) : docText(d));
    return { buffer, type: TYPES[format], ext: format, structure: d };
  }
  if (kind === 'slides') {
    if (!SLIDE_FORMATS.includes(format)) throw Object.assign(new Error(`format must be one of: ${SLIDE_FORMATS.join(', ')}`), { status: 400 });
    const d = normalizeSlides(structure);
    const buffer = format === 'pptx' ? await toPptx(d) : Buffer.from(slidesMarkdown(d));
    return { buffer, type: TYPES[format], ext: format, structure: d };
  }
  throw Object.assign(new Error('kind must be "document" or "slides"'), { status: 400 });
}
module.exports = { build, normalizeDocument, normalizeSlides, DOC_FORMATS, SLIDE_FORMATS };
