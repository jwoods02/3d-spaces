// Plain Node (req, res) handlers, shared by the Vite dev server and the
// Vercel functions in /api.
import { extractProduct, assertPublicUrl } from './extract.js';

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

const queryUrl = (req) => new URL(req.url, 'http://local').searchParams.get('url');

export async function productHandler(req, res) {
  try {
    const target = queryUrl(req);
    if (!target) return send(res, 400, { error: 'Missing ?url=' });
    send(res, 200, await extractProduct(target));
  } catch (err) {
    send(res, 422, { error: err.message || 'Could not read that page' });
  }
}

// Re-serves product images so three.js can use them as textures (most shop
// CDNs don't send CORS headers).
export async function imageHandler(req, res) {
  try {
    const target = assertPublicUrl(queryUrl(req) || '');
    const upstream = await fetch(target, {
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/*' },
      signal: AbortSignal.timeout(12000),
    });
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.startsWith('image/')) return send(res, 502, { error: 'Not an image' });
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) return send(res, 413, { error: 'Image too large' });
    res.statusCode = 200;
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'public, max-age=86400');
    res.end(buf);
  } catch (err) {
    send(res, 422, { error: err.message });
  }
}
