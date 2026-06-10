// Giba Steam Market — tracker read-only do Steam Community Market
// Slug: giba-steam-market · Porta: 5260 · Zero deps (Node 20+)
// Endpoints publicos da Steam, throttled + cache em disco. Sem login, sem trade automation.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as tbhSave from './tbh-save.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.GSM_PORT || 5260);
const DEFAULT_APPID = 3678970; // TBH: Task Bar Hero
const LIST_TTL_MS = 10 * 60 * 1000;   // cache da lista completa
const PRICE_TTL_MS = 5 * 60 * 1000;   // cache priceoverview por item
const PAGE_DELAY_MS = 1800;           // gentileza com a Steam (Steam capa anonimo em 10 itens/pagina)
const UA = 'giba-steam-market/1.0 (uso pessoal read-only)';

fs.mkdirSync(DATA, { recursive: true });
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(DATA, 'app.log'), line + '\n'); } catch {}
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cachePath = (appid) => path.join(DATA, `items-${appid}.json`);

const priceCache = new Map(); // key: appid|name → { at, data }
const refreshing = new Map(); // appid → Promise em andamento (dedup)

async function steamGet(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (res.status === 429) throw Object.assign(new Error('rate-limited'), { code: 429 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function readListCache(appid) {
  try { return JSON.parse(fs.readFileSync(cachePath(appid), 'utf8')); } catch { return null; }
}

async function fetchAllItems(appid) {
  const items = [];
  let start = 0, total = Infinity;
  while (start < total) {
    // country=US + currency=1 força USD consistente (sem isso a Steam às vezes responde em BRL pela região)
    const url = `https://steamcommunity.com/market/search/render/?appid=${appid}&norender=1&count=100&start=${start}&sort_column=price&sort_dir=desc&country=US&currency=1`;
    let j;
    try {
      j = await steamGet(url);
    } catch (e) {
      if (e.code === 429 && items.length) { log(`429 na pagina start=${start} — entregando parcial (${items.length})`); break; }
      throw e;
    }
    if (!j?.success) throw new Error('steam respondeu success=false');
    total = j.total_count ?? 0;
    for (const r of j.results || []) {
      const d = r.asset_description || {};
      items.push({
        name: r.name,
        hash: r.hash_name,
        priceCents: r.sell_price,
        priceText: r.sell_price_text,
        listings: r.sell_listings,
        type: d.type || '',
        color: d.name_color || '',
        icon: d.icon_url ? `https://community.fastly.steamstatic.com/economy/image/${d.icon_url}/96fx96f` : '',
        url: `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(r.hash_name)}`,
      });
    }
    const got = (j.results || []).length;
    if (!got) break; // pagina vazia = fim (evita loop infinito)
    start += got;    // Steam ignora count>10 sem cookie — anda pelo que veio de fato
    if (items.length % 100 < got) log(`appid ${appid}: ${items.length}/${total} itens`);
    if (start < total) await sleep(PAGE_DELAY_MS);
  }
  items.sort((a, b) => b.priceCents - a.priceCents);
  const payload = { appid, fetchedAt: Date.now(), total: items.length, items };
  fs.writeFileSync(cachePath(appid), JSON.stringify(payload));
  return payload;
}

function refreshDedup(appid) {
  if (!refreshing.has(appid)) {
    refreshing.set(appid, fetchAllItems(appid).finally(() => refreshing.delete(appid)));
  }
  return refreshing.get(appid);
}

async function apiItems(q) {
  const appid = Number(q.get('appid')) || DEFAULT_APPID;
  const force = q.get('refresh') === '1';
  const cached = readListCache(appid);
  const fresh = cached && (Date.now() - cached.fetchedAt) < LIST_TTL_MS;
  if (cached && fresh && !force) return { ...cached, stale: false };
  if (cached && !force) {
    // serve stale na hora, atualiza em background
    refreshDedup(appid).catch(e => log(`refresh bg falhou: ${e.message}`));
    return { ...cached, stale: true, refreshing: true };
  }
  return { ...(await refreshDedup(appid)), stale: false };
}

async function apiPrice(q) {
  const appid = Number(q.get('appid')) || DEFAULT_APPID;
  const name = q.get('name') || '';
  if (!name) throw new Error('name obrigatorio');
  const key = `${appid}|${name}`;
  const hit = priceCache.get(key);
  if (hit && (Date.now() - hit.at) < PRICE_TTL_MS) return hit.data;
  const url = `https://steamcommunity.com/market/priceoverview/?appid=${appid}&currency=7&market_hash_name=${encodeURIComponent(name)}`;
  const j = await steamGet(url);
  const data = { name, brl: j.lowest_price || null, medianBrl: j.median_price || null, volume: j.volume || null };
  priceCache.set(key, { at: Date.now(), data });
  return data;
}

const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'));

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  try {
    if (u.pathname === '/') return send(200, INDEX, 'text/html');
    if (u.pathname === '/api/items') return send(200, await apiItems(u.searchParams));
    if (u.pathname === '/api/price') return send(200, await apiPrice(u.searchParams));
    if (u.pathname === '/api/stash') {
      // só TBH tem leitura de save; outros appids retornam "não suportado"
      const appid = Number(u.searchParams.get('appid')) || DEFAULT_APPID;
      if (appid !== DEFAULT_APPID) return send(200, { supported: false });
      if (!tbhSave.saveExists()) return send(200, { supported: true, found: false });
      const market = readListCache(appid);
      if (!market) return send(200, { supported: true, found: true, needItems: true });
      return send(200, { supported: true, found: true, ...tbhSave.readStash(market.items) });
    }
    send(404, { error: 'not found' });
  } catch (e) {
    log(`ERRO ${u.pathname}: ${e.message}`);
    send(e.code === 429 ? 429 : 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => log(`Giba Steam Market ON → http://localhost:${PORT} (default appid ${DEFAULT_APPID})`));
