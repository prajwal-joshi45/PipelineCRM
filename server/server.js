const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth-routes');
const userRoutes = require('./routes/user-routes');
const leadRoutes = require('./routes/lead-routes');
const activityRoutes = require('./routes/activity-routes');
const settingsRoutes = require('./routes/settings-routes');
const quotationRoutes = require('./routes/quotation-routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' })); // 5mb headroom for XLSX bulk-import payloads

// Slow down brute-force guessing on login/setup specifically. Everything
// else is behind requireAuth anyway.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/setup', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/quotations', quotationRoutes);

// Serve the frontend from the same origin/port as the API, so there's no
// CORS setup needed and everyone on the network just hits one address.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pipeline CRM server running:`);
  console.log(`  On this machine:   http://localhost:${PORT}`);
  console.log(`  On your network:   http://<this-computer's-LAN-IP>:${PORT}  (find it with 'ipconfig' / 'ifconfig')`);
});
