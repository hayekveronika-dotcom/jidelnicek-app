// Ověření přihlášení přes Cloudflare Access pro všechny /api/* požadavky.
// Access stojí před celou aplikací; tady se navíc kontroluje podpis jeho tokenu (JWT),
// aby API nebylo otevřené, kdyby Access chyběl (např. na náhledové adrese *.pages.dev).
//
// Proměnné prostředí (Pages → Settings → Variables and Secrets):
//   ACCESS_TEAM_DOMAIN  např. "veronika.cloudflareaccess.com"
//   ACCESS_AUD          Application Audience (AUD) Tag z nastavení aplikace v Access

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

let certsCache = { url: null, keys: null, at: 0 };

async function getKeys(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (certsCache.url === url && Date.now() - certsCache.at < 3600_000) return certsCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Nepodařilo se načíst klíče Cloudflare Access.');
  const { keys } = await res.json();
  certsCache = { url, keys, at: Date.now() };
  return keys;
}

const b64urlToBytes = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
const b64urlToJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function verifyAccessJwt(token, teamDomain, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Neplatný token.');
  const header = b64urlToJson(parts[0]);
  const payload = b64urlToJson(parts[1]);
  if (header.alg !== 'RS256') throw new Error('Neplatný algoritmus tokenu.');

  let keys = await getKeys(teamDomain);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) { certsCache.at = 0; keys = await getKeys(teamDomain); jwk = keys.find(k => k.kid === header.kid); }
  if (!jwk) throw new Error('Neznámý klíč tokenu.');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('Neplatný podpis tokenu.');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('Přihlášení vypršelo.');
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) throw new Error('Token ještě neplatí.');
  if (payload.iss !== `https://${teamDomain}`) throw new Error('Token vydal někdo jiný.');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('Token nepatří této aplikaci.');
  return payload;
}

function readToken(request) {
  const h = request.headers.get('cf-access-jwt-assertion');
  if (h) return h;
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return json({ error: 'Server není nastavený: chybí ACCESS_TEAM_DOMAIN nebo ACCESS_AUD.' }, 500);
  }
  if (!env.DB) return json({ error: 'Server není nastavený: chybí propojení s databází D1 (binding DB).' }, 500);
  const token = readToken(request);
  if (!token) return json({ error: 'Nepřihlášeno.' }, 401);
  try {
    const payload = await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
    // e-mail u lidí, common_name u servisního tokenu (MCP)
    context.data.user = payload.email || payload.common_name || 'neznámý';
  } catch (e) {
    return json({ error: e.message }, 401);
  }
  return context.next();
}
