'use strict';

const { applyRateLimit, getEnv, requireBearerToken, verifyPortalToken } = require('./_lib/security');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    applyRateLimit(req, { key: 'profile', windowMs: 60_000, max: 20 });

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const token = requireBearerToken(req);
    const actor = await verifyPortalToken(token);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = String(body.action || 'sync').trim().toLowerCase();
    const fullName = String(body.fullName || '').trim();

    if (action !== 'sync') {
      res.status(400).json({ error: 'Unsupported profile action.' });
      return;
    }

    const response = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/portal_users?user_id=eq.${encodeURIComponent(actor.id)}`, {
      method: 'PATCH',
      headers: {
        apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        email: actor.email,
        ...(fullName ? { full_name: fullName } : {})
      })
    });

    if (!response.ok) {
      throw new Error(`Profile sync failed with ${response.status}.`);
    }

    const rows = await response.json();
    res.status(200).json({ ok: true, user: rows[0] || null });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Profile sync failed.' });
  }
};
