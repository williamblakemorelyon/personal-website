// api/chat.js
//
// This is a Vercel Serverless Function. It runs on Vercel's servers, not in
// the visitor's browser — so your API key stays hidden here and is never
// exposed to anyone viewing your website's source code.
//
// This version calls Mistral AI's "La Plateforme", using Mistral Small 4 —
// a genuinely open-weight model (Apache 2.0 license, weights on Hugging
// Face) rather than a closed proprietary model — chosen deliberately to
// match the open-access argument in "Leveraging Open Source LLMs for
// Historical Databases of Agricultural Science Research." Mistral AI is
// also a Paris-based, European company — a reasonable fit for a project
// situated in a German university context.
//
// NOTE: Mistral retires older model endpoints periodically (e.g., the
// original open-mixtral-8x7b was retired 3/30/2025). Using the "-latest"
// alias below, rather than a dated version string, means this keeps
// pointing at Mistral's current open Small model without needing a code
// change every time they release a new version. If you ever see errors,
// check https://docs.mistral.ai/models for the current recommended alias.
//
// SETUP:
// 1. Get an API key from https://console.mistral.ai (API Keys section).
//    Note: Mistral may ask you to activate billing before issuing a key,
//    even to use free-tier-eligible models — check current requirements
//    when you sign up.
// 2. In your Vercel project settings, add an Environment Variable:
//      Name:  MISTRAL_API_KEY
//      Value: (paste your key)
// 3. Deploy. This file becomes reachable at:  https://your-site.vercel.app/api/chat
//
// SAFETY NOTE: this endpoint is public — anyone visiting your live site can
// trigger it. Two easy safeguards:
//   (a) Only load a small amount of credit and don't enable auto-recharge —
//       spending simply stops once the balance runs out.
//   (b) The MAX_TOKENS and basic rate-limit below keep any single response
//       cheap and slow down rapid repeated requests from the same visitor.

const MODEL = "mistral-small-latest";
const MAX_TOKENS = 700;

// Extremely simple in-memory rate limit: max 15 requests per minute per IP.
// Resets whenever the function cold-starts, so it's a soft speed bump,
// not a hard security guarantee.
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

  if (!process.env.MISTRAL_API_KEY) {
    return res.status(500).json({ error: 'Server is missing MISTRAL_API_KEY. Set it in your Vercel project settings.' });
  }

  try {
    const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: message },
        ],
      }),
    });

    const data = await mistralRes.json();

    if (!mistralRes.ok) {
      return res.status(mistralRes.status).json({ error: data });
    }

    // Normalize Mistral's OpenAI-style response shape into the same shape
    // the frontend already expects (so no client-side code needs to change):
    //   { content: [ { type: "text", text: "..." } ] }
    const text = data?.choices?.[0]?.message?.content || '';
    return res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}



