const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ settings: db.raw.settings });
});

// Server-enforced admin-only, per the earlier decision to disable these
// inputs for non-admins in the UI — this is the check that actually matters.
router.put('/', requireAdmin, async (req, res) => {
  const { revenueGoal, commissionBase, quotationDefaults } = req.body || {};
  if (revenueGoal !== undefined) {
    const n = Number(revenueGoal);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'Revenue goal must be a positive number' });
    db.raw.settings.revenueGoal = n;
  }
  if (commissionBase !== undefined) {
    if (!['cash', 'deal'].includes(commissionBase)) return res.status(400).json({ error: 'commissionBase must be "cash" or "deal"' });
    db.raw.settings.commissionBase = commissionBase;
  }
  // quotationDefaults is a whole-object replace — the client always sends the
  // full edited defaults form, same pattern as the packages/scanners arrays
  // inside individual quotations.
  if (quotationDefaults !== undefined && quotationDefaults && typeof quotationDefaults === 'object') {
    db.raw.settings.quotationDefaults = quotationDefaults;
  }
  await db.persist();
  res.json({ settings: db.raw.settings });
});

module.exports = router;
