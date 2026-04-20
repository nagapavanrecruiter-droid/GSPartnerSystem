'use strict';

const { applyRateLimit, getEnv, requireBearerToken, verifyPortalToken } = require('./_lib/security');

const BUCKET = 'partner-files';

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    applyRateLimit(req, { key: 'partner-files', windowMs: 60_000, max: 60 });

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const token = requireBearerToken(req);
    await verifyPortalToken(token);

    const partnerId = String(req.query.partnerId || '').trim();
    const company = String(req.query.company || '').trim();
    const fileName = String(req.query.file || '').trim();
    if (!partnerId) {
      res.status(400).json({ error: 'partnerId is required.' });
      return;
    }

    const partner = await fetchPartner(partnerId);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found.' });
      return;
    }

    const folderCandidates = getPartnerStorageFolders(partner, company);
    if (!fileName) {
      const files = await listFiles(folderCandidates);
      res.status(200).json({ files });
      return;
    }

    const safeName = sanitizeFileName(fileName);
    const fileResponse = await fetchFileFromCandidates(folderCandidates, safeName);
    if (!fileResponse) {
      res.status(404).json({ error: 'Could not load requested file.' });
      return;
    }

    const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${safeName.replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(buffer);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'File request failed.' });
  }
};

async function fetchPartner(recordId) {
  const url = `${getEnv('SUPABASE_URL')}/rest/v1/partners?id=eq.${encodeURIComponent(recordId)}&select=id,company`;
  const response = await fetch(url, {
    headers: {
      apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Partner lookup failed with ${response.status}.`);
  }

  const rows = await response.json();
  return rows[0] || null;
}

async function listFiles(folderCandidates) {
  const results = [];
  const seen = new Set();

  for (const folderPath of folderCandidates) {
    const response = await fetch(`${getEnv('SUPABASE_URL')}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: {
        apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prefix: folderPath,
        limit: 100,
        offset: 0,
        sortBy: { column: 'name', order: 'desc' }
      })
    });

    if (!response.ok) {
      throw new Error(`File listing failed with ${response.status}.`);
    }

    const rows = await response.json();
    for (const entry of rows || []) {
      if (!entry?.name || String(entry.name).endsWith('/')) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      results.push({ name: entry.name });
    }
  }

  return results;
}

async function fetchFileFromCandidates(folderCandidates, safeName) {
  for (const folderPath of folderCandidates) {
    const objectPath = `${folderPath}/${safeName}`;
    const fileResponse = await fetch(`${getEnv('SUPABASE_URL')}/storage/v1/object/authenticated/${BUCKET}/${encodeURIComponentPath(objectPath)}`, {
      headers: {
        apikey: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        Authorization: `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`
      }
    });

    if (fileResponse.ok) {
      return fileResponse;
    }
  }

  return null;
}

function sanitizeFileName(value) {
  return String(value || 'file')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '-')
    .replace(/[\\/:*?"<>|#%&{}~]/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/\s+/g, '-')
    .trim()
    .slice(0, 180) || 'file';
}

function getPartnerStorageFolders(partner, requestedCompany) {
  const folders = new Set();
  const companyName = sanitizeFileName(requestedCompany || partner?.company || 'partner');
  const legacyId = sanitizeFileName(partner?.id || 'partner');
  if (companyName) folders.add(companyName);
  if (legacyId) folders.add(legacyId);
  return [...folders];
}

function encodeURIComponentPath(value) {
  return String(value)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}
