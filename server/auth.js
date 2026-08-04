const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const ROLE_PRESETS = {
  admin:  { label: 'Admin',  perms: { create: true,  edit: true,  delete: true,  viewMoney: true,  manageUsers: true } },
  closer: { label: 'Closer', perms: { create: true,  edit: true,  delete: false, viewMoney: true,  manageUsers: false } },
  setter: { label: 'Setter', perms: { create: true,  edit: true,  delete: false, viewMoney: false, manageUsers: false } },
  viewer: { label: 'Viewer', perms: { create: false, edit: false, delete: false, viewMoney: true,  manageUsers: false } },
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const USERNAME_RE = /^[a-z0-9._-]{3,20}$/;

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, username: u.username, role: u.role, perms: u.perms };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.raw.sessions.push({ token, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  // opportunistically drop expired sessions so the file doesn't grow forever
  db.raw.sessions = db.raw.sessions.filter(s => s.expiresAt > now);
  return db.persist().then(() => token);
}

function destroySession(token) {
  db.raw.sessions = db.raw.sessions.filter(s => s.token !== token);
  return db.persist();
}

// Express middleware: requires a valid, non-expired session token in
// `Authorization: Bearer <token>`. Attaches req.user (full record incl.
// passwordHash — route handlers must use publicUser() before sending it back).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const session = db.raw.sessions.find(s => s.token === token);
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
  const user = db.raw.users.find(u => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  req.user = user;
  req.sessionToken = token;
  next();
}

// This is the actual security boundary: no matter what the client sends or
// hides in its UI, every mutating route re-checks the permission server-side
// against the user record loaded from the database above.
function requirePerm(permKey) {
  return (req, res, next) => {
    if (!req.user || !req.user.perms || !req.user.perms[permKey]) {
      return res.status(403).json({ error: `You don't have "${permKey}" access` });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admins only' });
  }
  next();
}

module.exports = {
  ROLE_PRESETS, USERNAME_RE, publicUser,
  createSession, destroySession, requireAuth, requirePerm, requireAdmin,
  hashPassword: (pw) => bcrypt.hash(pw, 10),
  checkPassword: (pw, hash) => bcrypt.compare(pw, hash),
};
