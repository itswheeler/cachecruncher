// Cache Calc — Cloudflare Worker
// All calculations run client-side; the worker only serves static assets.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/feedback') {
      return handleFeedback(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleFeedback(request, env) {
  if (request.method === 'GET') {
    return jsonResponse(await readCounts(env));
  }

  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    const type = body?.type;
    if (type !== 'love' && type !== 'death') {
      return new Response('Invalid feedback type', { status: 400 });
    }

    const key = type;
    const current = Number(await env.cachecruncher_feedback.get(key) || 0);
    await env.cachecruncher_feedback.put(key, String(current + 1));
    return jsonResponse(await readCounts(env));
  }

  return new Response('Method Not Allowed', { status: 405 });
}

async function readCounts(env) {
  const love = Number(await env.cachecruncher_feedback.get('love') || 0);
  const death = Number(await env.cachecruncher_feedback.get('death') || 0);
  return { love, death };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
