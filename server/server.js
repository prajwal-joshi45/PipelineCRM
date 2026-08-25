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
app.set('trust proxy', 1);

app.use(express.json({ limit: '5mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/setup', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/quotations', quotationRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();

  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

module.exports = app;
