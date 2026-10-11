// Turns a product page URL into { name, image, price, width, height, depth, mount }.
// Dimensions are in metres. Heuristics run first; Claude refines them when
// ANTHROPIC_API_KEY is set.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That does not look like a URL');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http(s) links are supported');
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === '[::1]'
  ) {
    throw new Error('Private addresses are not allowed');
  }
  return url;
}

export async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`The shop returned ${res.status}`);
  return await res.text();
}

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function meta(html, key) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`,
    'i',
  );
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content.trim()) : null;
}

function jsonLdProducts(html) {
  const out = [];
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of blocks) {
    let data;
    try {
      data = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      const type = [].concat(node['@type'] || []).map(String);
      if (type.some((t) => /product/i.test(t))) out.push(node);
      if (node['@graph']) stack.push(node['@graph']);
    }
  }
  return out;
}

export function pageText(html) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/td|\/th|\/h\d|\/dt|\/dd)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();
}

const UNIT = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, inch: 0.0254, inches: 0.0254, '"': 0.0254 };
const unitOf = (u) => UNIT[(u || '').toLowerCase()] ?? null;
const NUM = '(\\d+(?:[.,]\\d+)?)';
const UNITS = '(mm|cm|m|inches|inch|in|")';
const num = (s) => Number(String(s).replace(',', '.'));

// Words before "height"/"width" that mean a part of the product, not the whole.
const PART_WORDS =
  /(seat|arm|leg|shelf|drawer|internal|inner|interior|handle|cushion|back|headboard|opening|clearance|hook|peg|frame|box|packag|carton|parcel|screen|max|min)\s*$/i;

export function parseDimensions(text) {
  const found = {};
  const take = (key, value, unit) => {
    const f = unitOf(unit);
    const v = num(value);
    if (!f || !v || found[key]) return;
    const m = v * f;
    if (m > 0.005 && m < 10) found[key] = m;
  };

  // "Height: 18.50cm", "Width 110 cm", "Depth (cm): 13.5"
  const labelled = new RegExp(
    `(.{0,24}?)\\b(overall\\s+)?(width|height|depth|length|diameter)\\b\\s*(?:\\((mm|cm|m|in)\\))?\\s*[:\\-]?\\s*${NUM}\\s*${UNITS}?`,
    'gi',
  );
  for (const m of text.matchAll(labelled)) {
    const [, before, , label, headerUnit, value, unit] = m;
    if (PART_WORDS.test(before)) continue;
    const key = { length: 'width', diameter: 'diameter' }[label.toLowerCase()] || label.toLowerCase();
    take(key, value, unit || headerUnit);
  }

  // "W110 x D13.5 x H18.5cm" or "H 18.5cm x W 110cm x D 13.5cm"
  const lettered = new RegExp(
    `\\b([WHDL])\\s*:?\\s*${NUM}\\s*${UNITS}?\\s*[x×*]\\s*([WHDL])\\s*:?\\s*${NUM}\\s*${UNITS}?\\s*[x×*]\\s*([WHDL])\\s*:?\\s*${NUM}\\s*${UNITS}`,
    'i',
  );
  const lm = text.match(lettered);
  if (lm) {
    const unit = lm[9];
    const letters = { W: 'width', L: 'width', H: 'height', D: 'depth' };
    take(letters[lm[1].toUpperCase()], lm[2], lm[3] || unit);
    take(letters[lm[4].toUpperCase()], lm[5], lm[6] || unit);
    take(letters[lm[7].toUpperCase()], lm[8], unit);
  }

  // "110 x 13.5 x 18.5 cm (W x D x H)"
  const triple = new RegExp(
    `${NUM}\\s*[x×*]\\s*${NUM}\\s*[x×*]\\s*${NUM}\\s*${UNITS}\\s*\\(?\\s*([WHDL])\\s*[x×*]\\s*([WHDL])\\s*[x×*]\\s*([WHDL])`,
    'i',
  );
  const tm = text.match(triple);
  if (tm) {
    const letters = { W: 'width', L: 'width', H: 'height', D: 'depth' };
    take(letters[tm[5].toUpperCase()], tm[1], tm[4]);
    take(letters[tm[6].toUpperCase()], tm[2], tm[4]);
    take(letters[tm[7].toUpperCase()], tm[3], tm[4]);
  }

  if (found.diameter) {
    found.width ??= found.diameter;
    found.depth ??= found.diameter;
  }
  delete found.diameter;
  return found;
}

const WALL_WORDS =
  /\b(wall[- ]?mount(ed)?|wall[- ]?hung|coat rack|coat hooks?|peg rail|hooks?\b|wall shelf|floating shelf|mirror|wall light|sconce|picture|print|frame|clock|key holder|wall cabinet)\b/i;
const FLOOR_WORDS = /\b(coat stand|hall stand|free[- ]?standing|floor[- ]?standing|floor mirror|leaning)\b/i;

export function guessMount(name, text) {
  const n = name || '';
  if (FLOOR_WORDS.test(n)) return 'floor';
  if (WALL_WORDS.test(n)) return 'wall';
  if (/\bwall[- ]?mount(ed)?\b|\bfix(es|ed)? to (the )?wall\b/i.test(text.slice(0, 20000))) return 'wall';
  return 'floor';
}

function absolute(src, base) {
  if (!src) return null;
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

export function extractHeuristic(html, url) {
  const products = jsonLdProducts(html);
  const p = products[0] || {};
  const text = pageText(html);

  const ldImage = [].concat(p.image || []).map((i) => (typeof i === 'string' ? i : i?.url)).find(Boolean);
  const name =
    (typeof p.name === 'string' && decode(p.name)) ||
    meta(html, 'og:title') ||
    decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim() ||
    'Product';
  const image = absolute(ldImage || meta(html, 'og:image') || meta(html, 'twitter:image'), url);
  const offer = [].concat(p.offers || [])[0] || {};
  const price =
    offer.price != null
      ? `${offer.priceCurrency === 'GBP' ? '£' : offer.priceCurrency ? offer.priceCurrency + ' ' : ''}${offer.price}`
      : meta(html, 'product:price:amount');

  const dims = parseDimensions(text);
  for (const k of ['width', 'height', 'depth']) {
    const v = p[k];
    const value = typeof v === 'object' ? v?.value : v;
    if (!dims[k] && value) {
      const unit = (typeof v === 'object' && v.unitCode) || 'cm';
      const f = { CMT: 0.01, MMT: 0.001, MTR: 1, INH: 0.0254 }[unit] ?? unitOf(unit) ?? 0.01;
      dims[k] = num(value) * f;
    }
  }

  return {
    name: name.split(/\s+[|–]\s+/)[0].trim(),
    image,
    price: price || null,
    ...dims,
    mount: guessMount(name, text),
    text,
  };
}

// Keeps the parts of the page most likely to mention size, so the prompt stays small.
function relevantText(text, max = 12000) {
  if (text.length <= max) return text;
  const lines = text.split('\n');
  const keep = new Set();
  lines.forEach((l, i) => {
    if (/dimension|size|width|height|depth|length|\bcm\b|\bmm\b|wall|mount|fix/i.test(l)) {
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) keep.add(j);
    }
  });
  const head = lines.slice(0, 40).join('\n');
  const body = [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n');
  return (head + '\n...\n' + body).slice(0, max);
}

async function refineWithClaude(guess, url) {
  const [{ default: Anthropic }, { z }, { zodOutputFormat }] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('zod'),
    import('@anthropic-ai/sdk/helpers/zod'),
  ]);
  const Schema = z.object({
    name: z.string(),
    width_cm: z.number().nullable(),
    height_cm: z.number().nullable(),
    depth_cm: z.number().nullable(),
    mount: z.enum(['wall', 'floor']),
  });
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    output_config: { effort: 'low', format: zodOutputFormat(Schema) },
    messages: [
      {
        role: 'user',
        content: `Extract the overall outer dimensions of the product on this shop page, in centimetres. Width is the side-to-side size when facing the front, height is floor-to-top (or top-to-bottom for wall items), depth is front-to-back. Use the whole product's size, not a part (seat height, shelf depth, packaging). Use null for any dimension the page does not give. mount is "wall" if the product hangs on or fixes to a wall (coat racks, hooks, mirrors, shelves, pictures), otherwise "floor".\n\nURL: ${url}\n\nPage text:\n${relevantText(guess.text)}`,
      },
    ],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
  return response.parsed_output;
}

export async function extractProduct(rawUrl) {
  const url = assertPublicUrl(rawUrl).toString();
  const html = await fetchPage(url);
  const guess = extractHeuristic(html, url);
  let source = 'page';

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const ai = await refineWithClaude(guess, url);
      if (ai) {
        guess.name = ai.name || guess.name;
        if (ai.width_cm) guess.width = ai.width_cm / 100;
        if (ai.height_cm) guess.height = ai.height_cm / 100;
        if (ai.depth_cm) guess.depth = ai.depth_cm / 100;
        guess.mount = ai.mount;
        source = 'claude';
      }
    } catch (err) {
      console.warn('Claude extraction failed, using page heuristics:', err.message);
    }
  }

  const { text, ...product } = guess;
  return {
    ...product,
    url,
    source,
    dimensionsFound: Boolean(product.width && product.height && product.depth),
  };
}
