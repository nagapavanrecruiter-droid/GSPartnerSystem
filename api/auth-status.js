'use strict';

const { applyRateLimit } = require('./_lib/security');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    applyRateLimit(req, { key: 'auth-status', windowMs: 60_000, max: 10 });

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    res.status(200).json({
      ok: true,
      message: 'Use the standard sign-in flow.'
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Auth status check failed.' });
  }
};
