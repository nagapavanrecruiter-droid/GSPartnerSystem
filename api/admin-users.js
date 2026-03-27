'use strict';

module.exports = async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      res.status(401).json({ error: 'Missing authorization token.' });
      return;
    }

    const actor = await getActorFromToken(token);
    const superAdminDomain = String(process.env.SUPER_ADMIN_DOMAIN || 'gensigma.com').toLowerCase();
    const adminDomains = String(process.env.ADMIN_ALLOWED_DOMAINS || 'gensigma.com')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    const canManage = ['shared_admin', 'super_admin'].includes(actor.role);

    if (!canManage) {
      res.status(403).json({ error: 'Only admins can manage access.' });
      return;
    }

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
    const sharedAdmin = assignedRole === 'shared_admin' || Boolean(body.sharedAdmin);
    const targetDomain = String(body.targetEmail || '').split('@')[1]?.toLowerCase() || '';

    if (!userId || !status) {
      res.status(400).json({ error: 'Missing user update payload.' });
      return;
    }

    if (assignedRole === 'shared_admin' && !adminDomains.includes(targetDomain)) {
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

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/portal_users?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        status,
        assigned_role: sharedAdmin ? 'shared_admin' : assignedRole,
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
    res.status(500).json({ error: error.message || 'Admin update failed.' });
  }
};

async function getActorFromToken(token) {
  const authResp = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });

  if (!authResp.ok) {
    throw new Error('Could not verify admin session.');
  }

  const authUser = await authResp.json();
  const roleResp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/portal_users?user_id=eq.${encodeURIComponent(authUser.id)}&select=assigned_role,shared_admin`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json'
    }
  });

  const roleRows = roleResp.ok ? await roleResp.json() : [];
  const profile = roleRows[0] || {};

  return {
    email: String(authUser.email || '').toLowerCase(),
    role: profile.shared_admin ? 'shared_admin' : String(profile.assigned_role || 'hr_admin')
  };
}

async function getApprovedSuperAdminCount() {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/portal_users?assigned_role=eq.super_admin&status=eq.approved&select=user_id`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
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
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/portal_users?user_id=eq.${encodeURIComponent(userId)}&select=assigned_role,status`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json'
    }
  });

  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0] || null;
}

async function getAllPortalUsers() {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/portal_users?select=*&order=created_at.desc`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json'
    }
  });

  if (!resp.ok) {
    throw new Error('Could not load portal users.');
  }

  return resp.json();
}
