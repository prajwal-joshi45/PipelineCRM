const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ["New","Proposal","Deposit","Follow-Up Ongoing","Meeting Follow-Up","Won","Lost"];
const MONEY_FIELDS = ['depositAmount','totalDealValue','cashCollected','datePaidInFull','refundAmount','commissionPct'];
const LEAD_FIELDS = [
  'leadName','company','email','phone','source','status','setterName','closerName',
  'dateCreated','firstContactDateTime','dateMeetingBooked','dateOfMeeting','meetingTime','lastTouchDate',
  'meetingStatus','offerMade','saleType','lossReason','remarks',
  'depositAmount','totalDealValue','cashCollected','datePaidInFull','refundAmount','commissionPct',
];
// Fields whose changes are worth calling out in a log's change summary —
// money fields are deliberately excluded so a Setter's activity log doesn't
// leak numbers they don't have permission to see.
const LOGGABLE_FIELDS = [
  'leadName','company','email','phone','source','status','setterName','closerName',
  'dateMeetingBooked','dateOfMeeting','meetingTime','lastTouchDate','meetingStatus','offerMade','saleType','lossReason',
];
const FIELD_LABELS = {
  leadName:'Lead Name', company:'Company', email:'Email', phone:'Phone', source:'Source', status:'Status',
  setterName:'Setter', closerName:'Closer', dateMeetingBooked:'Date Meeting Booked', dateOfMeeting:'Date of Meeting',
  meetingTime:'Meeting Time', lastTouchDate:'Last Touch Date', meetingStatus:'Meeting Status', offerMade:'Offer Made',
  saleType:'Sale Type', lossReason:'Loss Reason',
};

// Same masking the old client-side code did for money figures — now done
// server-side, so a Setter account genuinely never receives the numbers in
// the API response, not just has them hidden by CSS/JS in the browser.
function maskLead(lead, canViewMoney) {
  if (canViewMoney) return lead;
  const copy = { ...lead };
  for (const f of MONEY_FIELDS) copy[f] = null;
  return copy;
}

function sanitizeIncoming(body) {
  const out = {};
  for (const f of LEAD_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

// If a new/changed meeting date is being set and the caller didn't also
// explicitly send a "date meeting booked" value in this same request,
// default the booked date to today — that's the date this meeting was, in
// fact, booked.
function applyMeetingBookedDefault(before, data) {
  const meetingDateChanging = 'dateOfMeeting' in data && data.dateOfMeeting && data.dateOfMeeting !== (before && before.dateOfMeeting);
  const bookedDateExplicitlySent = 'dateMeetingBooked' in data && data.dateMeetingBooked;
  if (meetingDateChanging && !bookedDateExplicitlySent) {
    data.dateMeetingBooked = new Date().toISOString().slice(0, 10);
  }
}

function summarizeChanges(before, data) {
  const changed = [];
  for (const f of LOGGABLE_FIELDS) {
    if (!(f in data)) continue;
    const prev = before ? (before[f] || '') : '';
    const next = data[f] || '';
    if (prev !== next) changed.push(FIELD_LABELS[f] || f);
  }
  return changed;
}

function pushLog(lead, { by, remarks, changes, note }) {
  if (!lead.logs) lead.logs = [];
  lead.logs.push({
    id: db.id('LG'),
    at: new Date().toISOString(),
    by: by || 'Unknown',
    remarks: remarks || '',
    changes,
    note,
  });
}

router.get('/', (req, res) => {
  const canMoney = !!(req.user.perms && req.user.perms.viewMoney);
  res.json({ leads: db.raw.leads.map(l => maskLead(l, canMoney)) });
});

// Company duplicate check — used before creating a brand-new lead so the UI
// can offer "update the existing record instead" rather than silently
// creating a second lead for the same company.
router.get('/check-company', (req, res) => {
  const name = String(req.query.name || '').trim().toLowerCase();
  const excludeId = req.query.excludeId;
  if (!name) return res.json({ match: null });
  const canMoney = !!(req.user.perms && req.user.perms.viewMoney);
  const match = db.raw.leads.find(l => l.id !== excludeId && String(l.company || '').trim().toLowerCase() === name);
  res.json({ match: match ? maskLead(match, canMoney) : null });
});

router.post('/', requirePerm('create'), async (req, res) => {
  const data = sanitizeIncoming(req.body || {});
  if (!data.leadName) return res.status(400).json({ error: 'Lead name is required' });
  if (data.status === 'Lost' && !data.lossReason) {
    return res.status(400).json({ error: 'Loss Reason is required when status is Lost' });
  }
  applyMeetingBookedDefault(null, data);
  const lead = { id: db.id('L'), status: 'New', dateCreated: new Date().toISOString().slice(0, 10), ...data };
  pushLog(lead, { by: req.user.name, remarks: data.remarks, changes: ['Lead created'] });
  db.raw.leads.push(lead);
  await db.persist();
  res.json({ lead });
});

router.patch('/:id', requirePerm('edit'), async (req, res) => {
  const lead = db.raw.leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const data = sanitizeIncoming(req.body || {});
  applyMeetingBookedDefault(lead, data);
  const merged = { ...lead, ...data };
  if (merged.status === 'Lost' && !merged.lossReason) {
    return res.status(400).json({ error: 'Loss Reason is required when status is Lost' });
  }
  const changes = summarizeChanges(lead, data);
  Object.assign(lead, data);
  // Log every save — even if the only thing that changed was the remarks —
  // so remarks always land somewhere reviewable in the history.
  if (changes.length || data.remarks) {
    pushLog(lead, {
      by: req.user.name,
      remarks: data.remarks,
      changes: changes.length ? changes : undefined,
      note: !changes.length && data.remarks ? 'Remarks added' : undefined,
    });
  }
  await db.persist();
  res.json({ lead });
});

router.delete('/:id', requirePerm('delete'), async (req, res) => {
  const before = db.raw.leads.length;
  db.raw.leads = db.raw.leads.filter(l => l.id !== req.params.id);
  if (db.raw.leads.length === before) return res.status(404).json({ error: 'Lead not found' });
  await db.persist();
  res.json({ ok: true });
});

// XLSX import: client parses the spreadsheet into JSON rows and posts them
// here. Rows with an `id` matching an existing lead update it. Rows without
// an id (a fresh export or a hand-built sheet) get one generated here.
// Rows without an id that DO match an existing lead by company name are
// treated as an update to that record rather than a duplicate — bulk import
// has no interactive prompt to ask per-row, so this is the safe default;
// single-lead creation in the UI asks first (see check-company above).
router.post('/bulk-import', requirePerm('create'), async (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  let created = 0, updated = 0, mergedByCompany = 0, skipped = 0;
  for (const row of rows) {
    const data = sanitizeIncoming(row || {});
    if (!data.leadName) { skipped++; continue; }
    if (data.status && !STATUSES.includes(data.status)) data.status = 'New';
    let existing = row.id ? db.raw.leads.find(l => l.id === row.id) : null;
    let matchedByCompany = false;
    if (!existing && data.company) {
      existing = db.raw.leads.find(l => String(l.company || '').trim().toLowerCase() === String(data.company).trim().toLowerCase());
      if (existing) matchedByCompany = true;
    }
    if (existing) {
      applyMeetingBookedDefault(existing, data);
      const changes = summarizeChanges(existing, data);
      Object.assign(existing, data);
      pushLog(existing, {
        by: req.user.name,
        remarks: data.remarks,
        changes: changes.length ? changes : undefined,
        note: matchedByCompany ? 'Updated via bulk import (matched by company name)' : 'Updated via bulk import',
      });
      updated++;
      if (matchedByCompany) mergedByCompany++;
    } else {
      applyMeetingBookedDefault(null, data);
      // db.id('L') auto-generates an id for rows that arrived without one —
      // covers both a fresh sheet and a re-upload someone hand-edited.
      const lead = { id: db.id('L'), status: 'New', dateCreated: new Date().toISOString().slice(0, 10), ...data };
      pushLog(lead, { by: req.user.name, remarks: data.remarks, changes: ['Lead created via bulk import'] });
      db.raw.leads.push(lead);
      created++;
    }
  }
  await db.persist();
  res.json({ created, updated, mergedByCompany, skipped });
});

module.exports = router;
