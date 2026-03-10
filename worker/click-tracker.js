export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(request),
      });
    }

    // Health
    if (url.pathname === '/health') {
      return json({ ok: true, ts: Date.now() }, request);
    }

    // Ingest click event
    if (url.pathname === '/api/click' && request.method === 'POST') {
      try {
        const body = await request.json();
        const event = {
          ts: Date.now(),
          day: new Date().toISOString().slice(0, 10),
          type: String(body.type || 'open'), // open|link
          section: String(body.section || 'unknown'),
          title: String(body.title || 'unknown').slice(0, 240),
          source: String(body.source || ''),
          path: String(body.path || '/'),
          ua: request.headers.get('user-agent') || '',
        };

        const dayKey = `events:${event.day}`;
        const old = (await env.DAILY_PREF_KV.get(dayKey)) || '[]';
        const arr = JSON.parse(old);
        arr.push(event);
        // keep latest 5000/day
        const trimmed = arr.length > 5000 ? arr.slice(arr.length - 5000) : arr;
        await env.DAILY_PREF_KV.put(dayKey, JSON.stringify(trimmed));

        return json({ ok: true }, request);
      } catch (e) {
        return json({ ok: false, error: String(e) }, request, 400);
      }
    }

    // Aggregate preferences (last N days)
    if (url.pathname === '/api/prefs' && request.method === 'GET') {
      const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days') || 7)));
      const now = new Date();

      const section = {};
      const title = {};
      let opens = 0;
      let links = 0;

      for (let i = 0; i < days; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const day = d.toISOString().slice(0, 10);
        const raw = (await env.DAILY_PREF_KV.get(`events:${day}`)) || '[]';
        const arr = JSON.parse(raw);
        for (const e of arr) {
          section[e.section] = (section[e.section] || 0) + 1;
          title[e.title] = (title[e.title] || 0) + 1;
          if (e.type === 'open') opens++;
          if (e.type === 'link') links++;
        }
      }

      return json({ ok: true, days, section, title, opens, links }, request);
    }

    return json({ ok: false, error: 'not_found' }, request, 404);
  },
};

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(obj, request, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
    },
  });
}
