'use strict';

const rateLimitBuckets = new Map();

function getEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getClientIp(req) {
  return String(
    req.headers['x-forwarded-for']
      || req.headers['x-real-ip']
      || req.socket?.remoteAddress
      || 'unknown'
  ).split(',')[0].trim();
}

function applyRateLimit(req, { key, windowMs, max }) {
  const now = Date.now();
  const bucketKey = `${key}:${getClientIp(req)}`;
  const current = rateLimitBuckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= max) {
    const error = new Error('Too many requests.');
    error.statusCode = 429;
    throw error;
  }

  current.count += 1;
}

async function verifyPortalToken(token, { requireApproved = true } = {}) {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const anonKey = getEnv('SUPABASE_ANON_KEY');
  const serviceRole = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const authResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!authResp.ok) {
    const error = new Error('Invalid or expired session.');
    error.statusCode = 401;
    throw error;
  }

  const authUser = await authResp.json();
  const profileResp = await fetch(`${supabaseUrl}/rest/v1/portal_users?user_id=eq.${encodeURIComponent(authUser.id)}&select=user_id,email,assigned_role,access_level,shared_admin,status`, {
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      Accept: 'application/json'
    }
  });

  if (!profileResp.ok) {
    throw new Error('Could not load access profile.');
  }

  const rows = await profileResp.json();
  const profile = rows[0];
  if (!profile) {
    const error = new Error('No access profile found.');
    error.statusCode = 403;
    throw error;
  }

  if (requireApproved && profile.status !== 'approved') {
    const error = new Error('User is not approved.');
    error.statusCode = 403;
    throw error;
  }

  return {
    id: authUser.id,
    email: String(authUser.email || '').toLowerCase(),
    role: profile.shared_admin ? 'shared_admin' : String(profile.assigned_role || 'hr_admin'),
    accessLevel: String(profile.access_level || 'read').toLowerCase() === 'edit' ? 'edit' : 'read',
    sharedAdmin: Boolean(profile.shared_admin),
    status: profile.status
  };
}

function requireBearerToken(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const error = new Error('Missing authorization token.');
    error.statusCode = 401;
    throw error;
  }
  return token;
}

function isEditActor(actor) {
  return actor.sharedAdmin || actor.role === 'super_admin' || actor.accessLevel === 'edit';
}

module.exports = {
  applyRateLimit,
  getEnv,
  isEditActor,
  requireBearerToken,
  verifyPortalToken
};
