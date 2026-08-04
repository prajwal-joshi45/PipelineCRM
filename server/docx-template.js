const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'quotation-template.docx');

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Good enough for the plain runs of text we're matching against — this
// template doesn't contain apostrophes/quotes inside <w:t> that we search on.
function xmlUnescape(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function fmtDateDash(dateStr, monthCase) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  let month = MONTHS[d.getMonth()];
  if (monthCase === 'lower') month = month.toLowerCase();
  return `${d.getDate()}-${month}-${d.getFullYear()}`;
}
function fmtDateSpace(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtMoneyPlain(n) {
  // The original document uses plain Western thousands grouping ("120,000"),
  // not Indian lakh grouping ("1,20,000") — match that exactly.
  return Math.round(Number(n || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Replaces text inside a single <w:p>...</w:p> XML chunk. Word frequently
// splits one visible phrase across several <w:r> runs (spellcheck, manual
// edits, etc.) — string-replacing the raw XML directly would silently miss
// those. Instead: concatenate every run's text in this paragraph, apply the
// find/replace rules that apply to this paragraph (via optional anchor) to
// the concatenated text, then collapse the *entire* new text into the first
// text-bearing run (keeping its formatting) and blank out the rest. This
// preserves every other paragraph completely untouched, which is the point —
// "use my original formats, just change the values".
function replaceInParagraph(paragraphXml, rules) {
  const runRegex = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  const runs = [];
  let m;
  while ((m = runRegex.exec(paragraphXml))) {
    runs.push({ start: m.index, end: m.index + m[0].length, xml: m[0] });
  }
  if (!runs.length) return paragraphXml;

  const runTexts = runs.map(r => {
    const tm = r.xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
    return tm ? xmlUnescape(tm[1]) : null;
  });
  const fullText = runTexts.map(t => t || '').join('');

  let newText = fullText;
  let changed = false;
  for (const rule of rules) {
    if (rule.anchor && !fullText.includes(rule.anchor)) continue;
    if (rule.find === '' || rule.find === undefined) continue;
    if (newText.includes(rule.find)) {
      newText = newText.split(rule.find).join(rule.replace);
      changed = true;
    }
  }
  if (!changed) return paragraphXml;

  const firstIdx = runTexts.findIndex(t => t !== null);
  if (firstIdx === -1) return paragraphXml;

  // Process from the end backward so earlier positions stay valid as we splice.
  let out = paragraphXml;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runTexts[i] === null) continue;
    const newInner = (i === firstIdx) ? xmlEscape(newText) : '';
    const newRunXml = runs[i].xml.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/, `<w:t xml:space="preserve">${newInner}</w:t>`);
    out = out.slice(0, runs[i].start) + newRunXml + out.slice(runs[i].end);
  }
  return out;
}

function applyRules(documentXml, rules) {
  return documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, p => replaceInParagraph(p, rules));
}

// Builds the anchor/find/replace rule list for one quotation. Anchors scope a
// rule to only the paragraph(s) that contain that anchor text, so short
// generic numbers (package prices, day counts) never risk touching an
// unrelated number elsewhere in the document.
function buildRules(q) {
  const rules = [];
  const company = q.company || '';
  const fromCompany = q.fromCompany || 'Bizonet Technology Solutions';
  const pkgByName = {};
  (q.packages || []).forEach(p => { pkgByName[(p.name || '').trim().toLowerCase()] = p; });
  const silver = pkgByName['silver'], gold = pkgByName['gold'], platinum = pkgByName['platinum'];

  // Cover page + document control
  rules.push({ find: 'GENUINE SPARES', replace: company.toUpperCase() });
  rules.push({ find: 'BIZONET TECHNOLOGY SOLUTIONS', replace: fromCompany.toUpperCase() });
  rules.push({ find: 'V.1.0', replace: q.version || 'V.1.0' });
  rules.push({ find: '14-july-2026', replace: fmtDateDash(q.issueDate, 'lower') });
  rules.push({ find: '13-July-2026', replace: fmtDateDash(q.issueDate, 'title') });
  rules.push({ find: 'BZ-JO-2026-12', replace: q.docId || '' });
  rules.push({ find: 'Bizonet Technology Solutions', replace: fromCompany });
  rules.push({ anchor: 'Bizonet- Genuine Spares', find: 'Genuine Spares', replace: company });
  rules.push({ anchor: 'material management for the Company', find: 'Genuine Spares', replace: company });

  // Modules — matched against the original default text so an edited
  // description swaps in cleanly; module ORDER/COUNT stays as the template's
  // fixed six, per "use my original format". Comparison is against our own
  // app's default desc text (not the docx's raw punctuation), so an
  // unedited module is left completely untouched — no unnecessary rewrite
  // just because the docx uses an en-dash where our defaults use a hyphen.
  const moduleDefaults = [
    ['Unloading Box', 'Unloading Box - A webpage will be provided for unloading the boxes.', 'A webpage will be provided for unloading the boxes.'],
    ['Product Box Validation', 'Product Box Validation – It is a page for providing the rack location of the scanned products.', 'It is a page for providing the rack location of the scanned products.'],
    ['Loading of Orders', 'Loading of Orders – A page will be provided to load the .csv excel containing order information to the Bizonet Platform. ', 'A page will be provided to load the .csv excel containing order information to the Bizonet Platform.'],
    ['Store Out Screen', 'Store Out Screen- A webpage will be provided which will help you in boxing the items picked as per the order. ', 'A webpage will be provided which will help you in boxing the items picked as per the order.'],
    ['Dispatch', 'Dispatch – A webpage will be provided which will help you in dispatching the materials to your customer.  Invoices will be available along with this functionality.', 'A webpage will be provided which will help you in dispatching the materials to your customer. Invoices will be available along with this functionality.'],
    ['Reports', 'Reports - Details of the scanned Orders, Manual entry will be provided over the reports.', 'Details of the scanned Orders, Manual entry will be provided over the reports.'],
  ];
  (q.modules || []).forEach((m, i) => {
    const def = moduleDefaults[i];
    if (!def) return;
    const [title, originalParagraph, defaultDesc] = def;
    const desc = (m.desc || '').trim();
    if (desc && desc !== defaultDesc.trim()) {
      const newLine = `${m.title || title} - ${desc}`;
      rules.push({ anchor: title, find: originalParagraph.trim(), replace: newLine });
    } else if (m.title && m.title.trim() !== title) {
      // Only the title changed — swap just that part, leave the docx's
      // original dash/description formatting exactly as it is.
      rules.push({ anchor: title, find: title, replace: m.title.trim() });
    }
  });

  // Assumptions / Exclusions — only rewritten if the user actually edited them
  const defaultAssumptions = [
    'It is assumed that the Client will have desktops, laptops, mobiles or any other system with the latest browser version for the Management system to work on all the machines. ',
    'The staff required to use the Management system should be educated enough to understand the basic functionalities of the Management system, in order to use the system successfully. ',
  ];
  (q.assumptions || []).forEach((a, i) => {
    const def = defaultAssumptions[i];
    if (def && a.trim() && a.trim() !== def.trim()) rules.push({ find: def.trim(), replace: a.trim() });
  });
  const defaultExclusions = [
    'Any module which is not mentioned above in the Project Scope Definition.',
    'Any additional training that is required other than the mentioned above in the Project Scope Definition.',
  ];
  (q.exclusions || []).forEach((a, i) => {
    const def = defaultExclusions[i];
    if (def && a.trim() && a.trim() !== def.trim()) rules.push({ find: def.trim(), replace: a.trim() });
  });

  // Add-ons (Inward / Outward / Add-Ons bullets)
  const defaultAddOns = [
    'Inward (Container Unloading, Box Validation, Product Racking)',
    'Outward (Order Pick up, Boxing)',
    'Add-Ons (Logistics Management, Inventory Segregation) – Including in Package.',
  ];
  (q.addOns || []).forEach((a, i) => {
    const def = defaultAddOns[i];
    if (def && a.title && a.title.trim() && a.title.trim() !== def) rules.push({ find: def, replace: a.title.trim() });
  });

  // Packages — price + spec substitutions, scoped per package so short
  // numbers never bleed across paragraphs. Recommended-tag placement follows
  // whichever package is currently flagged, not necessarily Gold.
  if (silver) {
    rules.push({ anchor: 'Silver Package', find: '120,000', replace: fmtMoneyPlain(silver.price) });
    if (silver.machines !== undefined && silver.machines !== '') rules.push({ anchor: 'Silver Package', find: '-1 MACHINE', replace: `-${silver.machines} MACHINE` });
    if (silver.users !== undefined && silver.users !== '') rules.push({ anchor: 'Silver Package', find: '10 User CPU Cycles', replace: `${silver.users} User CPU Cycles` });
    if (silver.storage) rules.push({ anchor: 'Silver Package', find: '10GB STORAGE', replace: `${silver.storage} STORAGE`.toUpperCase() });
    if (silver.recommended) rules.push({ anchor: 'Silver Package', find: ')', replace: ') (Recommended considering your load)' });
  }
  if (gold) {
    rules.push({ anchor: 'Gold Package', find: '140,000', replace: fmtMoneyPlain(gold.price) });
    if (gold.machines !== undefined && gold.machines !== '') rules.push({ anchor: 'Gold Package', find: '-1 MACHINE', replace: `-${gold.machines} MACHINE` });
    if (gold.users !== undefined && gold.users !== '') rules.push({ anchor: 'Gold Package', find: '20 User CPU Cycles', replace: `${gold.users} User CPU Cycles` });
    if (gold.storage) rules.push({ anchor: 'Gold Package', find: '15GB STORAGE', replace: `${gold.storage} STORAGE`.toUpperCase() });
    if (!gold.recommended) rules.push({ anchor: 'Gold Package', find: ' (Recommended considering your load)', replace: '' });
  }
  if (platinum) {
    rules.push({ anchor: 'Platinum Package', find: '160,000', replace: fmtMoneyPlain(platinum.price) });
    if (platinum.machines !== undefined && platinum.machines !== '') rules.push({ anchor: 'Platinum Package', find: 'S-2 Machine', replace: `S-${platinum.machines} Machine` });
    if (platinum.users !== undefined && platinum.users !== '') rules.push({ anchor: 'Platinum Package', find: '50 User CPU Cycles', replace: `${platinum.users} User CPU Cycles` });
    if (platinum.storage) rules.push({ anchor: 'Platinum Package', find: '15 GB Storage', replace: `${platinum.storage} Storage`.replace(/gb/i, ' GB') });
    if (platinum.recommended) rules.push({ anchor: 'Platinum Package', find: ')', replace: ') (Recommended considering your load)' });
  }

  // Implementation + scanners
  if (q.implementationCostPerDay !== undefined) {
    rules.push({ anchor: 'Implementation Cost', find: '8000/Day', replace: `${fmtMoneyPlain(q.implementationCostPerDay)}/Day` });
  }
  const scanners = q.scanners || [];
  if (scanners[0] && scanners[0].price !== undefined) rules.push({ anchor: '3GB 32GB', find: '25000/-', replace: `${fmtMoneyPlain(scanners[0].price)}/-` });
  if (scanners[1] && scanners[1].price !== undefined) rules.push({ anchor: '4GB 64GB', find: '27100/-', replace: `${fmtMoneyPlain(scanners[1].price)}/-` });

  // Payment terms + validity + scanner requirement counts
  const defaultPaymentTerms = 'The total project fees would be divided into two parts for payment as half yearly forward looking.';
  if (q.paymentTerms && q.paymentTerms.trim() && q.paymentTerms.trim() !== defaultPaymentTerms) {
    rules.push({ find: defaultPaymentTerms, replace: q.paymentTerms.trim() });
  }
  rules.push({ find: '20 July 2026', replace: fmtDateSpace(q.validTill) });

  const sr = q.scannerRequirements || {};
  rules.push({
    anchor: 'Based on our understanding of your business',
    find: 'we can recommend you to have 1 scanners for inward and 2 scanners for your packing and 1 dispatch purpose.',
    replace: `we can recommend you to have ${sr.inward||0} scanners for inward and ${sr.packing||0} scanners for your packing and ${sr.dispatch||0} dispatch purpose.`,
  });

  return rules;
}

async function buildQuotationDocx(quote) {
  const buf = fs.readFileSync(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Template is missing word/document.xml');
  let xml = await docFile.async('string');
  xml = applyRules(xml, buildRules(quote));
  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { buildQuotationDocx };
