const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ activity: db.raw.activity });
});

router.post('/', requirePerm('create'), async (req, res) => {
  const { date, setter, dials, dms, conversations } = req.body || {};
  if (!setter || !setter.trim()) return res.status(400).json({ error: 'Enter a setter name' });
  const row = {
    id: db.id('A'),
    date: date || new Date().toISOString().slice(0, 10),
    setter: setter.trim(),
    dials: Number(dials) || 0,
    dms: Number(dms) || 0,
    conversations: Number(conversations) || 0,
    createdBy: req.user.id,
  };
  db.raw.activity.push(row);
  await db.persist();
  res.json({ activity: row });
});

router.delete('/:id', requirePerm('delete'), async (req, res) => {
  const before = db.raw.activity.length;
  db.raw.activity = db.raw.activity.filter(a => a.id !== req.params.id);
  if (db.raw.activity.length === before) return res.status(404).json({ error: 'Activity row not found' });
  await db.persist();
  res.json({ ok: true });
});

module.exports = router;
