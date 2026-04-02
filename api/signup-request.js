'use strict';

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const userId = String(body.user_id || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.full_name || '').trim();
    const requestedRole = String(body.requested_role || 'business_development_executive').trim();
    const assignedRole = String(body.assigned_role || 'hr_admin').trim();
    const status = String(body.status || 'pending').trim();
    const sharedAdmin = Boolean(body.shared_admin);

    if (!userId || !email || !fullName) {
      res.status(400).json({ error: 'Missing signup request fields.' });
      return;
    }

    const allowedDomains = String(process.env.ALLOWED_DOMAINS || process.env.ADMIN_ALLOWED_DOMAINS || 'gensigma.com')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const adminDomains = String(process.env.ADMIN_ALLOWED_DOMAINS || 'gensigma.com')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const superAdminDomain = String(process.env.SUPER_ADMIN_DOMAIN || 'gensigma.com').toLowerCase();
    const domain = email.split('@')[1] || '';

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

    const existing = await fetchExistingPortalUser(email, userId);
    if (existing) {
      res.status(409).json({ error: 'An account request already exists for this email.' });
      return;
    }

    if (status === 'approved') {
      const approvedAccessAdminCount = await getApprovedAccessAdminCount();
      if (assignedRole === 'shared_admin' && approvedAccessAdminCount > 0) {
        res.status(400).json({ error: 'A Shared Admin can only be auto-approved when no admin account exists yet.' });
        return;
      }
      if (assignedRole === 'super_admin') {
        const superAdminCount = await getApprovedSuperAdminCount();
        if (superAdminCount > 0) {
          res.status(400).json({ error: 'Only one approved Super Admin is allowed.' });
          return;
        }
        if (approvedAccessAdminCount > 0) {
          res.status(400).json({ error: 'A Super Admin cannot be auto-approved after admin accounts already exist.' });
          return;
        }
      }
    }

    const payload = {
      user_id: userId,
      email,
      full_name: fullName,
      requested_role: requestedRole,
      assigned_role: sharedAdmin ? 'shared_admin' : assignedRole,
      access_level: sharedAdmin || assignedRole === 'super_admin' ? 'edit' : 'read',
      status,
      shared_admin: sharedAdmin
    };

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/portal_users`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
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
    res.status(500).json({ error: error.message || 'Signup request failed.' });
  }
};

async function fetchExistingPortalUser(email, userId) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/portal_users?or=(email.eq.${encodeURIComponent(email)},user_id.eq.${encodeURIComponent(userId)})&select=user_id,email`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
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

async function getApprovedSuperAdminCount() {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/portal_users?assigned_role=eq.super_admin&status=eq.approved&select=user_id`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error('Could not validate approved Super Admin count.');
  }

  const rows = await response.json();
  return rows.length;
}

async function getApprovedAccessAdminCount() {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/portal_users?status=eq.approved&select=user_id,assigned_role,shared_admin`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error('Could not validate approved admin count.');
  }

  const rows = await response.json();
  return rows.filter((row) => row.shared_admin || row.assigned_role === 'super_admin').length;
}
