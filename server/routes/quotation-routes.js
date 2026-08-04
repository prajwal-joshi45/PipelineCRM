const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../auth');
const { buildQuotationDocx } = require('../docx-template');

const router = express.Router();
router.use(requireAuth);

// Quotations are free-form JSON blobs (a snapshot of the pricing form at
// save time) rather than a fixed column list like leads — the packages,
// scanners, and module rows are themselves arrays the user edits per quote,
// so there's no fixed schema to whitelist field-by-field. We just cap what
// keys are accepted at the top level.
const QUOTE_FIELDS = [
  'company', 'contactName', 'contactPhone', 'contactEmail', 'leadId',
  'docId', 'version', 'issueDate', 'validTill', 'gstPct',
  'modules', 'addOns', 'packages', 'implementationCostPerDay', 'implementationDays',
  'scanners', 'scannerRequirements', 'paymentTerms', 'assumptions', 'exclusions', 'notes',
  'chosenPackageIdx',
];

function sanitizeIncoming(body) {
  const out = {};
  for (const f of QUOTE_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

// Same log-on-every-save pattern as leads: every create/update gets a
// reviewable history entry with who, when, and what changed.
const SCALAR_LOG_FIELDS = ['company','contactName','contactPhone','docId','version','issueDate','validTill','gstPct','implementationCostPerDay','implementationDays','paymentTerms','notes','chosenPackageIdx'];
const ARRAY_LOG_FIELDS = ['modules','addOns','packages','scanners','scannerRequirements'];
const FIELD_LABELS = {
  company:'Company', contactName:'Contact Name', contactPhone:'Contact Phone', docId:'Document ID', version:'Version',
  issueDate:'Issue Date', validTill:'Valid Till', gstPct:'GST %', implementationCostPerDay:'Implementation Cost/Day',
  implementationDays:'Implementation Days', paymentTerms:'Payment Terms', notes:'Notes', chosenPackageIdx:'Chosen Package',
  modules:'Modules', addOns:'Scope Covered', packages:'Packages', scanners:'Scanners', scannerRequirements:'Scanner Requirements',
};

function summarizeQuoteChanges(before, data) {
  const changed = [];
  for (const f of SCALAR_LOG_FIELDS) {
    if (!(f in data)) continue;
    const prev = before ? (before[f] ?? '') : '';
    const next = data[f] ?? '';
    if (String(prev) !== String(next)) changed.push(FIELD_LABELS[f] || f);
  }
  for (const f of ARRAY_LOG_FIELDS) {
    if (!(f in data)) continue;
    const prev = before ? JSON.stringify(before[f] ?? null) : 'null';
    const next = JSON.stringify(data[f] ?? null);
    if (prev !== next) changed.push(FIELD_LABELS[f] || f);
  }
  return changed;
}

function pushQuoteLog(quote, { by, changes, note }) {
  if (!quote.logs) quote.logs = [];
  quote.logs.push({
    id: db.id('QLG'),
    at: new Date().toISOString(),
    by: by || 'Unknown',
    changes: changes && changes.length ? changes : undefined,
    note,
  });
}

router.get('/', (req, res) => {
  res.json({ quotations: db.raw.quotations });
});

router.post('/', requirePerm('create'), async (req, res) => {
  const data = sanitizeIncoming(req.body || {});
  if (!data.company) return res.status(400).json({ error: 'Company name is required' });
  const quote = {
    id: db.id('Q'),
    createdAt: new Date().toISOString(),
    createdBy: req.user.name,
    ...data,
  };
  pushQuoteLog(quote, { by: req.user.name, changes: ['Quotation created'] });
  db.raw.quotations.push(quote);
  await db.persist();
  res.json({ quotation: quote });
});

router.patch('/:id', requirePerm('edit'), async (req, res) => {
  const quote = db.raw.quotations.find(q => q.id === req.params.id);
  if (!quote) return res.status(404).json({ error: 'Quotation not found' });
  const data = sanitizeIncoming(req.body || {});
  const before = { ...quote };
  const changes = summarizeQuoteChanges(before, data);
  Object.assign(quote, data, { updatedAt: new Date().toISOString() });
  pushQuoteLog(quote, { by: req.user.name, changes, note: changes.length ? undefined : 'Saved with no field changes' });
  await db.persist();
  res.json({ quotation: quote });
});

router.delete('/:id', requirePerm('delete'), async (req, res) => {
  const before = db.raw.quotations.length;
  db.raw.quotations = db.raw.quotations.filter(q => q.id !== req.params.id);
  if (db.raw.quotations.length === before) return res.status(404).json({ error: 'Quotation not found' });
  await db.persist();
  res.json({ ok: true });
});

// Generates the quotation as a real .docx, built from the original
// Genuine Spares template with only the values (company, prices, dates)
// swapped in — same fonts, layout, logo, and section structure as the
// source file.
router.get('/:id/docx', (req, res, next) => {
  const quote = db.raw.quotations.find(q => q.id === req.params.id);
  if (!quote) return res.status(404).json({ error: 'Quotation not found' });
  const fromCompany = (db.raw.settings.quotationDefaults && db.raw.settings.quotationDefaults.fromCompany) || 'Bizonet Technology Solutions';
  buildQuotationDocx({ ...quote, fromCompany })
    .then(buffer => {
      const safeName = (quote.docId || quote.company || 'quotation').replace(/[^a-z0-9\-_. ]/gi, '_');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
      res.send(buffer);
    })
    .catch(next);
});

module.exports = router;
