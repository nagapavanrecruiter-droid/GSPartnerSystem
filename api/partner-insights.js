'use strict';

const ALLOWED_MODES = new Set(['summary', 'score']);
const SUPABASE_TABLE = 'partners';

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const recordId = String(body.recordId || '').trim();
    const mode = String(body.mode || '').trim();

    if (!recordId || !ALLOWED_MODES.has(mode)) {
      res.status(400).json({ error: 'recordId and mode are required.' });
      return;
    }

    const partner = await fetchPartner(recordId);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found.' });
      return;
    }

    const payload = buildGroqRequest(partner, mode);
    const output = await callGroq(payload);
    res.status(200).json(parseGroqOutput(output, mode));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Partner insights failed.' });
  }
};

async function fetchPartner(recordId) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(recordId)}&select=id,employee,company,website,contact,email,technologies,status,opportunities,event_id,notes,capability_statement,updated_at,updated_by`;
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase lookup failed with ${response.status}.`);
  }

  const rows = await response.json();
  return rows[0] || null;
}

function buildGroqRequest(partner, mode) {
  const system = [
    'You are an internal partner capability analyst.',
    'Use only the provided partner record.',
    'Do not mention missing external data.',
    'Do not answer as a chatbot.',
    'Return valid JSON only.'
  ].join(' ');

  const prompt = mode === 'score'
    ? [
        'Evaluate the partner for future opportunity fit on a 0-100 scale.',
        'Use only capability statement, technologies, partner status, notes, and opportunities.',
        'Return JSON with keys: score, summary, reasons.'
      ].join(' ')
    : [
        'Create a PPT-style capability summary.',
        'Return JSON with keys: title, summary, slides.',
        'slides must be an array of objects with title and bullets.',
        'Create at most 4 slides.'
      ].join(' ');

  return {
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: JSON.stringify({
          instruction: prompt,
          partner: {
            id: partner.id,
            employee: partner.employee,
            company: partner.company,
            website: partner.website,
            contact: partner.contact,
            email: partner.email,
            technologies: partner.technologies,
            status: partner.status,
            opportunities: partner.opportunities,
            event_id: partner.event_id,
            notes: partner.notes,
            capability_statement: partner.capability_statement,
            updated_at: partner.updated_at,
            updated_by: partner.updated_by
          }
        })
      }
    ]
  };
}

async function callGroq(payload) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Groq request failed with ${response.status}.`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content || '{}';
}

function parseGroqOutput(content, mode) {
  const parsed = JSON.parse(content || '{}');
  if (mode === 'score') {
    return {
      score: Number(parsed.score || 0),
      summary: String(parsed.summary || ''),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : []
    };
  }

  return {
    title: String(parsed.title || 'Capability Summary'),
    summary: String(parsed.summary || ''),
    slides: Array.isArray(parsed.slides)
      ? parsed.slides.map((slide) => ({
          title: String(slide.title || 'Slide'),
          bullets: Array.isArray(slide.bullets) ? slide.bullets.map(String).slice(0, 5) : []
        }))
      : []
  };
}
