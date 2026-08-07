const express = require('express');
const db = require('../db');
const {
  ROLE_PRESETS, USERNAME_RE, publicUser,
  requireAuth, requireAdmin, hashPassword,
} = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireAdmin, (req, res) => {
  res.json({ users: db.raw.users.map(publicUser) });
});

// Login time tracking — who logged in and when. Admin-only, same as the
// rest of the team-management surface.
router.get('/logins', requireAdmin, (req, res) => {
  const logs = db.raw.loginLogs.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({ logins: logs.slice(0, 500) });
});

router.post('/', requireAdmin, async (req, res) => {
  const { name, username, password, role, phone, email, joinDate } = req.body || {};
  const uname = (username || '').trim().toLowerCase();
  if (!name || !name.trim()) return res.status(400).json({ error: 'Enter a display name' });
  if (!uname || !USERNAME_RE.test(uname)) return res.status(400).json({ error: 'Username: 3-20 chars, letters/numbers/./_/- only' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!ROLE_PRESETS[role]) return res.status(400).json({ error: 'Invalid role' });
  if (db.raw.users.some(u => u.username === uname)) return res.status(400).json({ error: 'That username is already taken' });

  const user = {
    id: db.id('U'), name: name.trim(), username: uname,
    passwordHash: await hashPassword(password),
    role, perms: { ...ROLE_PRESETS[role].perms }, createdAt: Date.now(),
    phone: (phone || '').trim(), email: (email || '').trim(), joinDate: joinDate || '',
  };
  db.raw.users.push(user);
  await db.persist();
  res.json({ user: publicUser(user) });
});

// Change role (and therefore perms), or hand-tune individual perms.
router.patch('/:id', requireAdmin, async (req, res) => {
  const user = db.raw.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { role, perms, password, phone, email, joinDate } = req.body || {};
  if (role) {
    if (!ROLE_PRESETS[role]) return res.status(400).json({ error: 'Invalid role' });
    user.role = role;
    user.perms = { ...ROLE_PRESETS[role].perms };
  }
  if (perms && typeof perms === 'object') {
    user.perms = { ...user.perms, ...perms };
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    user.passwordHash = await hashPassword(password);
  }
  if (phone !== undefined) user.phone = String(phone).trim();
  if (email !== undefined) user.email = String(email).trim();
  if (joinDate !== undefined) user.joinDate = joinDate;
  await db.persist();
  res.json({ user: publicUser(user) });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't remove your own account" });
  }
  const before = db.raw.users.length;
  db.raw.users = db.raw.users.filter(u => u.id !== req.params.id);
  if (db.raw.users.length === before) return res.status(404).json({ error: 'User not found' });
  // Also kill any active sessions for the removed user.
  db.raw.sessions = db.raw.sessions.filter(s => s.userId !== req.params.id);
  await db.persist();
  res.json({ ok: true });
});

module.exports = router;
