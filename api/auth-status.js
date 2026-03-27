'use strict';

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();

    if (!email) {
      res.status(400).json({ error: 'Email is required.' });
      return;
    }

    const url = `${process.env.SUPABASE_URL}/rest/v1/portal_users?email=eq.${encodeURIComponent(email)}&select=email,status,assigned_role,requested_role,shared_admin`;
    const response = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Auth status lookup failed with ${response.status}.`);
    }

    const rows = await response.json();
    const user = rows[0] || null;
    res.status(200).json({
      exists: Boolean(user),
      status: user?.status || null,
      assignedRole: user?.shared_admin ? 'shared_admin' : (user?.assigned_role || null),
      requestedRole: user?.requested_role || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Auth status check failed.' });
  }
};
