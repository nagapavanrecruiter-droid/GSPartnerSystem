'use strict';

const { applyRateLimit, getEnv } = require('./_lib/security');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    applyRateLimit(req, { key: 'signup-request', windowMs: 60_000, max: 5 });

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const userId = String(body.user_id || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.full_name || '').trim();
    const requestedRole = String(body.requested_role || 'business_development_executive').trim();

    if (!userId || !email || !fullName) {
      res.status(400).json({ error: 'Missing signup request fields.' });
      return;
    }

    if (!VALID_ROLES.includes(requestedRole)) {
      res.status(400).json({ error: 'Invalid requested role.' });
      return;
    }

    const domain = email.split('@')[1] || '';
    const allowedDomains = String(process.env.ALLOWED_DOMAINS || process.env.ADMIN_ALLOWED_DOMAINS || 'gensigma.com')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const adminDomains = String(process.env.ADMIN_ALLOWED_DOMAINS || 'gensigma.com')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const superAdminDomain = String(process.env.SUPER_ADMIN_DOMAIN || 'gensigma.com').toLowerCase();

    if (!allowedDomains.includes(domain)) {
      res.status(400).json({ error: 'Email domain is not allowed.' });
      return;
    }

    if (requestedRole === 'shared_admin' && !adminDomains.includes(domain)) {
      res.status(400).json({ error: 'This email domain cannot request Shared Admin access.' });
      return;
    }

    if (requestedRole === 'super_admin' && domain !== superAdminDomain) {
      res.status(400).json({ error: `Only @${superAdminDomain} users can request Super Admin access.` });
      return;
    }

    const authUser = await fetchAuthUser(userId);
    const authEmail = String(authUser?.email || '').trim().toLowerCase();
    if (!authEmail || authEmail !== email) {
      res.status(400).json({ error: 'Signup request does not match a verified auth user.' });
      return;
    }

    if (!authUser.email_confirmed_at && !authUser.confirmed_at) {
      res.status(400).json({ error: 'Email must be confirmed before requesting access.' });
      return;
    }

    const existing = await fetchExistingPortalUser(email, userId);
    if (existing) {
      res.status(409).json({ error: 'An account request already exists for this email.' });
      return;
    }

    const payload = {
      user_id: userId,
      email,
      full_name: fullName,
      requested_role: requestedRole,
      assigned_role: 'hr_admin',
      access_level: 'read',
      status: 'pending',
      shared_admin: false
    };

    const response = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/portal_users`, {
      method: 'POST',
      headers: {
        apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Signup request failed with ${response.status}.`);
    }

    const rows = await response.json();
    res.status(200).json({ ok: true, user: rows[0] || payload });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Signup request failed.' });
  }
};

const VALID_ROLES = [
  'super_admin',
  'shared_admin',
  'business_development_executive',
  'account_executive',
  'bid_management',
  'proposal_writer',
  'hr_admin'
];

async function fetchAuthUser(userId) {
  const response = await fetch(`${getEnv('SUPABASE_URL')}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('Could not verify auth user.');
  }

  const json = await response.json();
  return json.user || null;
}

async function fetchExistingPortalUser(email, userId) {
  const response = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/portal_users?or=(email.eq.${encodeURIComponent(email)},user_id.eq.${encodeURIComponent(userId)})&select=user_id,email`,
    {
      headers: {
        apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        Accept: 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error('Could not validate existing signup request.');
  }

  const rows = await response.json();
  return rows[0] || null;
}
