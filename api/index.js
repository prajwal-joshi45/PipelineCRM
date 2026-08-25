const app = require('../server');
const db = require('../db');

let readyPromise;

module.exports = async (req, res) => {
  try {
    if (!readyPromise) {
      readyPromise = db.ready();
    }

    await readyPromise;

    return app(req, res);
  } catch (err) {
    console.error('Application startup error:', err);

    return res.status(500).json({
      error: 'Failed to initialize application'
    });
  }
};
