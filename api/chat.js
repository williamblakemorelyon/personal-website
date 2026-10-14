// api/chat.js
//
// Vercel Serverless Function. Runs on Vercel's servers, not in the visitor's
// browser, so the Mistral API key stays hidden here.
//
// SETUP:
// 1. In Mistral Studio (console.mistral.ai) create an API key, add a small
//    prepaid balance, and set a monthly spending limit under
//    Admin Panel > Subscriptions > Billing. Also switch on the API data
//    opt-out so prompts are not used to improve models.
// 2. In Vercel > Project > Settings > Environment Variables add:
//      MISTRAL_API_KEY = (your key)
//    Optional: MISTRAL_MODEL = a specific model name. Defaults to
//    "mistral-small-latest" (Mistral's current open-weight Small model).
// 3. Redeploy. This becomes reachable at /api/chat.
//
// The browser still receives the same response shape the tool already
// understands: { content: [ { type: "text", text: "..." } ] }.
//
// A previous Anthropic/Claude version is kept in backup/chat.anthropic.js
// (outside the api/ folder so Vercel does not treat it as a live endpoint).

const MAX_TOKENS = 700;
const TEMPERATURE = 0.2; // low: we want faithful answers grounded in the records
const MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

// Soft per-IP rate limit: 15 requests per minute. Resets on cold start, so it
// is a speed bump only. The monthly spending limit in Mistral Studio is the
// real safety net.
const requestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 15;
  const timestamps = (requestLog.get(ip) || []).filter(t => now - t < windowMs);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > limit;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  const { system, message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing "message" in request body.' });
  }

  if (!process.env.MISTRAL_API_KEY) {
    return res.status(500).json({ error: 'Server is missing MISTRAL_API_KEY. Set it in your Vercel project settings.' });
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: message });

  try {
    const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      }),
    });

    const data = await mistralRes.json().catch(() => ({}));

    if (!mistralRes.ok) {
      if (mistralRes.status === 429) {
        return res.status(429).json({ error: 'The model service is busy or the monthly usage limit has been reached. Please try again in a moment.' });
      }
      const detail = data?.message || data?.error?.message || data?.detail || `Mistral request failed (${mistralRes.status})`;
      return res.status(mistralRes.status).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
    }

    // Mistral can return content as a string or as an array of parts.
    const raw = data?.choices?.[0]?.message?.content;
    const text = Array.isArray(raw)
      ? raw.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
      : (raw || '');

    // Normalize to the shape the front end already reads.
    return res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
