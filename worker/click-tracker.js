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

    // Create deep-analysis task (for H5 "解读" button)
    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      try {
        const body = await request.json();
        const taskId = crypto.randomUUID();
        const now = Date.now();
        const task = {
          id: taskId,
          status: 'queued',
          createdAt: now,
          updatedAt: now,
          source: {
            title: String(body.title || '').slice(0, 240),
            fact: String(body.fact || '').slice(0, 2000),
            digest: String(body.digest || '').slice(0, 4000),
            links: Array.isArray(body.links) ? body.links.slice(0, 8).map(String) : [],
            section: String(body.section || ''),
          },
          requester: {
            channel: String(body.channel || 'discord'),
            to: String(body.to || ''),
          },
          result: null,
          error: null,
        };

        await env.DAILY_PREF_KV.put(`analyze:task:${taskId}`, JSON.stringify(task), { expirationTtl: 60 * 60 * 24 * 7 });

        const qKey = 'analyze:queue';
        const qRaw = (await env.DAILY_PREF_KV.get(qKey)) || '[]';
        const queue = JSON.parse(qRaw);
        queue.push({ id: taskId, ts: now });
        await env.DAILY_PREF_KV.put(qKey, JSON.stringify(queue.slice(-5000)), { expirationTtl: 60 * 60 * 24 * 7 });

        return json({ ok: true, taskId, status: 'queued' }, request);
      } catch (e) {
        return json({ ok: false, error: String(e) }, request, 400);
      }
    }

    // Poll task status
    if (url.pathname.startsWith('/api/analyze/') && request.method === 'GET') {
      const taskId = url.pathname.split('/').pop();
      const raw = await env.DAILY_PREF_KV.get(`analyze:task:${taskId}`);
      if (!raw) return json({ ok: false, error: 'task_not_found' }, request, 404);
      const task = JSON.parse(raw);
      return json({ ok: true, task }, request);
    }

    // Callback write result from OpenClaw executor
    if (url.pathname.startsWith('/api/analyze/') && url.pathname.endsWith('/callback') && request.method === 'POST') {
      try {
        const taskId = url.pathname.split('/')[3];
        const raw = await env.DAILY_PREF_KV.get(`analyze:task:${taskId}`);
        if (!raw) return json({ ok: false, error: 'task_not_found' }, request, 404);
        const task = JSON.parse(raw);
        const body = await request.json();

        task.status = String(body.status || 'done'); // done|failed
        task.updatedAt = Date.now();
        task.result = body.result || null;
        task.error = body.error || null;

        await env.DAILY_PREF_KV.put(`analyze:task:${taskId}`, JSON.stringify(task), { expirationTtl: 60 * 60 * 24 * 7 });
        return json({ ok: true }, request);
      } catch (e) {
        return json({ ok: false, error: String(e) }, request, 400);
      }
    }

    // Optional: fetch queue snapshot for executor
    if (url.pathname === '/api/analyze-queue' && request.method === 'GET') {
      const qRaw = (await env.DAILY_PREF_KV.get('analyze:queue')) || '[]';
      const queue = JSON.parse(qRaw);
      return json({ ok: true, queue }, request);
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
