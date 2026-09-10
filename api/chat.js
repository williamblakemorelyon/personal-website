// api/chat.js
//
// This is a Vercel Serverless Function. It runs on Vercel's servers, not in
// the visitor's browser — so your Anthropic API key stays hidden here and is
// never exposed to anyone viewing your website's source code.
//
// SETUP:
// 1. Get an API key from https://console.anthropic.com (Settings > API Keys).
// 2. In your Vercel project settings, add an Environment Variable:
//      Name:  ANTHROPIC_API_KEY
//      Value: (paste your key)
// 3. Deploy. This file becomes reachable at:  https://your-site.vercel.app/api/chat
//
// NOTE: this project's original goal was to use an open-weight, ideally
// European-hosted model (see FUTURE_PLANS.md) to match the open-access
// argument in "Leveraging Open Source LLMs for Historical Databases of
// Agricultural Science Research." This Anthropic/Claude version is a
// pragmatic fallback after hitting real friction with Mistral AI (a
// retired model, then unclear free-tier rate limits) — reverted to here to
// keep the live demo working, with the open/European swap revisited later.
//
// SAFETY NOTE: this endpoint is public — anyone visiting your live site can
// trigger it, which means anyone could send it requests and use your API
// budget. Two easy safeguards:
//   (a) In the Anthropic Console, set a monthly spending limit on this key.
//   (b) The MAX_TOKENS and basic rate-limit below keep any single response
//       cheap and slow down rapid repeated requests from the same visitor.

const MAX_TOKENS = 700;

// Extremely simple in-memory rate limit: max 15 requests per minute per IP.
// Resets whenever the function cold-starts, so it's a soft speed bump,
// not a hard security guarantee — the spending cap in (a) above is your
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
    return res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' });
  }

  const { system, message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing "message" in request body.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Set it in your Vercel project settings.' });
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: MAX_TOKENS,
        system: system || undefined,
        messages: [{ role: 'user', content: message }],
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      return res.status(anthropicRes.status).json({ error: data });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
