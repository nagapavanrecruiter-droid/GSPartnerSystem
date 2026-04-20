'use strict';

const { applyRateLimit, getEnv, requireBearerToken, verifyPortalToken } = require('./_lib/security');

const VALID_ROLES = [
  'super_admin',
  'shared_admin',
  'business_development_executive',
  'account_executive',
  'bid_management',
  'proposal_writer',
  'hr_admin'
];

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    applyRateLimit(req, { key: 'admin-users', windowMs: 60_000, max: 30 });

    const token = requireBearerToken(req);
    const actor = await verifyPortalToken(token);
    const canManage = ['shared_admin', 'super_admin'].includes(actor.role);
    if (!canManage) {
      res.status(403).json({ error: 'Only admins can manage access.' });
      return;
    }

    const superAdminDomain = String(process.env.SUPER_ADMIN_DOMAIN || 'gensigma.com').toLowerCase();
    const adminDomains = String(process.env.ADMIN_ALLOWED_DOMAINS || 'gensigma.com')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    if (req.method === 'GET') {
      const users = await getAllPortalUsers();
      res.status(200).json({ users });
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const userId = String(body.userId || '').trim();
    const status = String(body.status || '').trim();
    const assignedRole = String(body.assignedRole || 'hr_admin').trim();
    const accessLevel = String(body.accessLevel || 'read').trim().toLowerCase() === 'edit' ? 'edit' : 'read';
    const targetEmail = String(body.targetEmail || '').trim().toLowerCase();
    const targetDomain = targetEmail.split('@')[1] || '';
    const sharedAdmin = assignedRole === 'shared_admin';

    if (!userId || !status || !VALID_ROLES.includes(assignedRole)) {
      res.status(400).json({ error: 'Invalid user update payload.' });
      return;
    }

    if (sharedAdmin && !adminDomains.includes(targetDomain)) {
      res.status(400).json({ error: 'Target user email domain is not allowed for admin access.' });
      return;
    }

    if (assignedRole === 'super_admin' && targetDomain !== superAdminDomain) {
      res.status(400).json({ error: `Only @${superAdminDomain} users can hold Super Admin access.` });
      return;
    }

    if (assignedRole === 'super_admin') {
      const superAdminCount = await getApprovedSuperAdminCount();
      const targetProfile = await getTargetProfile(userId);
      const isAlreadySuperAdmin = targetProfile?.assigned_role === 'super_admin' && targetProfile?.status === 'approved';
      if (superAdminCount > 0 && !isAlreadySuperAdmin) {
        res.status(400).json({ error: 'Only one approved Super Admin is allowed.' });
        return;
      }
    }

    const response = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/portal_users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        status,
        assigned_role: sharedAdmin ? 'shared_admin' : assignedRole,
        access_level: sharedAdmin || assignedRole === 'super_admin' ? 'edit' : accessLevel,
        shared_admin: sharedAdmin,
        approved_by: actor.email,
        approved_at: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`User access update failed with ${response.status}.`);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Admin update failed.' });
  }
};

async function getApprovedSuperAdminCount() {
  const resp = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/portal_users?assigned_role=eq.super_admin&status=eq.approved&select=user_id`, {
    headers: {
      apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
      Accept: 'application/json'
    }
  });

  if (!resp.ok) {
    throw new Error('Could not validate Super Admin count.');
  }

  const rows = await resp.json();
  return rows.length;
}

async function getTargetProfile(userId) {
  const resp = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/portal_users?user_id=eq.${encodeURIComponent(userId)}&select=assigned_role,status`, {
    headers: {
      apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
      Accept: 'application/json'
    }
  });

  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0] || null;
}

async function getAllPortalUsers() {
  const resp = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/portal_users?select=user_id,email,full_name,requested_role,assigned_role,access_level,status,shared_admin,created_at&order=created_at.desc`, {
    headers: {
      apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
      Accept: 'application/json'
    }
  });

  if (!resp.ok) {
    throw new Error('Could not load portal users.');
  }

  return resp.json();
}
