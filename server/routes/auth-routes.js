const express = require('express');
const db = require('../db');
const {
  ROLE_PRESETS, USERNAME_RE, publicUser,
  createSession, destroySession, requireAuth,
  hashPassword, checkPassword,
} = require('../auth');

const router = express.Router();

function validateNewAccount(name, username, password) {
  if (!name || !name.trim()) return 'Enter a display name';
  if (!username || !USERNAME_RE.test(username)) return 'Username: 3-20 chars, letters/numbers/./_/- only';
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (db.raw.users.some(u => u.username === username)) return 'That username is already taken';
  return null;
}

// Only usable when there are zero users — bootstraps the first Admin.
// After that this route always 403s, so it can't be used to mint a second
// unauthenticated admin later.
router.post('/setup', async (req, res) => {
  if (db.raw.users.length > 0) {
    return res.status(403).json({ error: 'Setup already complete. Ask an existing admin to add you.' });
  }
  const { name, username, password } = req.body || {};
  const uname = (username || '').trim().toLowerCase();
  const err = validateNewAccount(name, uname, password);
  if (err) return res.status(400).json({ error: err });

  const user = {
    id: db.id('U'),
    name: name.trim(),
    username: uname,
    passwordHash: await hashPassword(password),
    role: 'admin',
    perms: { ...ROLE_PRESETS.admin.perms },
    createdAt: Date.now(),
  };
  db.raw.users.push(user);
  await db.persist();
  const token = await createSession(user.id);
  res.json({ token, user: publicUser(user) });
});

router.get('/setup-needed', (req, res) => {
  res.json({ needed: db.raw.users.length === 0 });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const uname = (username || '').trim().toLowerCase();
  const user = db.raw.users.find(u => u.username === uname);
  // Same generic error whether the username or password was wrong, so a
  // caller can't use this endpoint to enumerate valid usernames.
  if (!user || !(await checkPassword(password || '', user.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  const token = await createSession(user.id);
  res.json({ token, user: publicUser(user) });
});

router.post('/logout', requireAuth, async (req, res) => {
  await destroySession(req.sessionToken);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
