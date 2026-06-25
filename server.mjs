// Giba Steam Market — tracker read-only do Steam Community Market
// Slug: giba-steam-market · Porta: 5260 · Zero deps (Node 20+)
// Endpoints publicos da Steam, throttled + cache em disco. Sem login, sem trade automation.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
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

const throttledLogs = new Map();
function logThrottled(key, msg, ms = 30_000) {
  const now = Date.now();
  const last = throttledLogs.get(key) || 0;
  if (now - last < ms) return;
  throttledLogs.set(key, now);
  log(msg);
}

function logStashSummary(stash) {
  const src = stash.dataSources
    ? `tabela=${stash.dataSources.itemTable}/${stash.dataSources.itemTableCount}, nomes=${stash.dataSources.itemNames}/${stash.dataSources.itemNamesCount}`
    : 'fontes=desconhecidas';
  const msg = `BAU OK: ${stash.totalItems || 0} itens unicos, ${stash.pricedItems || 0} com preco, ${stash.unlistedItems || 0} sem anuncio, ${stash.unpricedItems || 0} sem mercado, ${stash.types || 0} tipos na tela, duplicados ignorados=${stash.duplicateSlotRefsIgnored || 0}, ${src}`;
  const key = `stash:${stash.totalItems}:${stash.pricedItems}:${stash.unlistedItems}:${stash.unpricedItems}:${stash.types}:${src}`;
  logThrottled(key, msg, 15_000);
  if ((stash.totalItems || 0) > 0 && !(stash.items || []).length) {
    logThrottled(`stash-empty:${key}`, 'BAU AVISO: o save foi lido, mas nenhum item entrou na lista. A tela deve mostrar o diagnostico; se isso acontecer no ZIP publico, baixe a ultima versao.', 60_000);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cachePath = (appid) => path.join(DATA, `items-${appid}.json`);

const priceCache = new Map(); // key: appid|name → { at, data }
const refreshing = new Map(); // appid → Promise em andamento (dedup)
const stashCache = new Map(); // appid → { at, saveMtime, data } — baú lido (invalida no mtime do save)
const orderbookCache = new Map(); // key: appid|hash → { at, data }
const ORDERBOOK_TTL_MS = 3 * 60 * 1000; // ordens mudam rápido; 3min é bom equilíbrio
const ORDERBOOK_DELAY_MS = 650;          // throttle entre itens do baú (gentileza com a Steam)

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

// Preço USD por hash via priceoverview (currency=1). Cache em memória (mesmo do apiPrice mas key USD).
async function priceUsdCents(appid, hash) {
  const key = `${appid}|usd|${hash}`;
  const hit = priceCache.get(key);
  if (hit && (Date.now() - hit.at) < PRICE_TTL_MS) return hit.data;
  const url = `https://steamcommunity.com/market/priceoverview/?appid=${appid}&currency=1&market_hash_name=${encodeURIComponent(hash)}`;
  const j = await steamGet(url);
  // "$1.23" → 123 centavos. lowest_price é o preço de venda mais barato (o que vale o item).
  const parse = (s) => { const m = String(s || '').match(/[\d.,]+/); if (!m) return null; return Math.round(parseFloat(m[0].replace(',', '')) * 100); };
  const cents = parse(j.lowest_price) ?? parse(j.median_price);
  const data = { hash, priceCents: cents, volume: j.volume || null, hasListing: cents != null };
  priceCache.set(key, { at: Date.now(), data });
  return data;
}

// Resolve sob demanda os preços dos itens "pendentes" do baú (negociáveis cujo preço não veio no
// cache parcial do mercado). Server controla o throttle. NÃO depende do cache estar cheio.
async function apiStashPrices(q) {
  const appid = Number(q.get('appid')) || DEFAULT_APPID;
  if (!tbhSave.saveExists()) return { found: false };
  const market = readListCache(appid);
  const stash = tbhSave.readStash(market ? market.items : []);
  const pendentes = (stash.items || []).filter(it => it.pricePending && it.hash);
  const priceByHash = {};
  let resolved = 0, failed = 0;
  for (const it of pendentes) {
    try {
      const p = await priceUsdCents(appid, it.hash);
      if (p.priceCents != null) { priceByHash[it.hash] = p.priceCents; resolved++; }
      else failed++; // success mas sem preço = não vende mesmo
    } catch (e) {
      failed++;
      if (e.code === 429) { log(`stash-prices: 429 — entregando ${resolved} resolvidos parciais`); break; }
    }
    await sleep(ORDERBOOK_DELAY_MS);
  }
  const out = tbhSave.applyResolvedPrices(stash, priceByHash);
  logStashSummary(out);
  return { supported: true, found: true, resolved, failed, pendingLeft: out.pendingItems, ...out };
}

// ── Ordens de compra (buy orders) — venda imediata ────────────────────────
// A UI nova da Steam usa /market/orderbook?q=Load&qp=[appid,"hash"] (sem item_nameid).
// Retorna em centavos na moeda da REGIÃO (eCurrency 7 = BRL). Funciona com fetch puro.
const CUR_SYMBOL = { 1: '$', 7: 'R$' };

function classifyLiquidez(buyCount) {
  if (!buyCount) return 'nenhuma';
  if (buyCount > 500) return 'alta';
  if (buyCount >= 50) return 'media';
  return 'baixa';
}

async function fetchOrderbook(appid, hash) {
  const key = `${appid}|${hash}`;
  const hit = orderbookCache.get(key);
  if (hit && (Date.now() - hit.at) < ORDERBOOK_TTL_MS) return hit.data;
  const qp = encodeURIComponent(JSON.stringify([Number(appid), hash]));
  const url = `https://steamcommunity.com/market/orderbook?q=Load&qp=${qp}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
      'Referer': `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(hash)}`,
    },
  });
  if (res.status === 429) throw Object.assign(new Error('rate-limited'), { code: 429 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const d = (j && j.success && j.data) ? j.data : {};
  const buyCount = d.cBuyOrders || 0;
  const data = {
    hash,
    maxBuyCents: d.amtMaxBuyOrder ?? null,   // valor que você recebe vendendo NA HORA
    minSellCents: d.amtMinSellOrder ?? null, // anúncio de venda mais barato
    buyCount,
    sellCount: d.cSellOrders || 0,
    currency: d.eCurrency || null,
    symbol: CUR_SYMBOL[d.eCurrency] || '',
    liquidez: classifyLiquidez(buyCount),
  };
  orderbookCache.set(key, { at: Date.now(), data });
  return data;
}

// Busca as ordens de TODOS os itens do baú do Giba (server controla o throttle).
async function apiStashOrders(q) {
  const appid = Number(q.get('appid')) || DEFAULT_APPID;
  if (!tbhSave.saveExists()) return { found: false };
  const market = readListCache(appid);
  if (!market) return { found: true, needItems: true };
  const stash = tbhSave.readStash(market.items);
  // só itens que têm hash de mercado (dá pra vender) e que eu possuo
  const owned = (stash.items || []).filter(it => it.hash && (it.qty || it.count || 1) > 0);
  const out = [];
  let totalImediatoCents = 0;
  let currency = null, symbol = '';
  for (const it of owned) {
    const qty = it.qty || it.count || 1;
    try {
      const ob = await fetchOrderbook(appid, it.hash);
      currency = currency || ob.currency; symbol = symbol || ob.symbol;
      const subtotal = ob.maxBuyCents ? ob.maxBuyCents * qty : 0;
      totalImediatoCents += subtotal;
      out.push({ name: it.name, hash: it.hash, qty,
        maxBuyCents: ob.maxBuyCents, minSellCents: ob.minSellCents,
        buyCount: ob.buyCount, liquidez: ob.liquidez, subtotalCents: subtotal });
    } catch (e) {
      out.push({ name: it.name, hash: it.hash, qty, error: e.code === 429 ? 'rate-limited' : e.message });
      if (e.code === 429) break; // parou de raspar; devolve o que já tem
    }
    await sleep(ORDERBOOK_DELAY_MS);
  }
  // OBJETIVO: vender RÁPIDO. Quem tem mais ordens de compra ativas (cBuyOrders) tem
  // mais gente esperando pra comprar = venda imediata batendo na ordem. Ordena por isso.
  // Itens SEM ordem de compra vão pro fim (não dá pra vender rápido). Desempate: maior
  // valor da ordem de compra por unidade (entre os líquidos, pega o que rende mais).
  out.sort((a, b) =>
    (b.buyCount || 0) - (a.buyCount || 0) ||
    (b.maxBuyCents || 0) - (a.maxBuyCents || 0));
  return { found: true, currency, symbol, totalImediatoCents, count: out.length, items: out };
}

// ── Varredura Fiel: consulta o orderbook de CADA item do baú, 1 a 1 ──────────────────────
// Inclui itens que NÃO casam com o cache de mercado (muitos materiais não têm anúncio de venda,
// somem do priceoverview, mas têm centenas de ordens de COMPRA). Roda em background com throttle
// de 700ms; o front faz polling do progresso. É o "demora mais, mas é fiel" pedido pelo Giba.
const SCAN_DELAY_MS = 700; // testado: aguenta sem 429
const scans = new Map();   // appid → { status, total, done, items, totalImediatoCents, currency, symbol, startedAt, error }

async function runStashScan(appid) {
  const market = readListCache(appid);
  const stash = tbhSave.readStash(market ? market.items : []);
  const entries = (stash.allEntries || []).filter(e => e.searchName && e.qty > 0);
  const state = { status: 'running', total: entries.length, done: 0, items: [],
    totalImediatoCents: 0, currency: null, symbol: '', startedAt: Date.now(), error: null };
  scans.set(appid, state);
  try {
    for (const e of entries) {
      try {
        const ob = await fetchOrderbook(appid, e.searchName); // reusa cache 3min + throttle interno
        state.currency = state.currency || ob.currency;
        state.symbol = state.symbol || ob.symbol;
        const subtotal = ob.maxBuyCents ? ob.maxBuyCents * e.qty : 0;
        state.totalImediatoCents += subtotal;
        state.items.push({ name: e.name, hash: e.searchName, qty: e.qty, kind: e.kind, matched: e.matched,
          maxBuyCents: ob.maxBuyCents, minSellCents: ob.minSellCents, buyCount: ob.buyCount,
          liquidez: ob.liquidez, subtotalCents: subtotal });
      } catch (err) {
        if (err.code === 429) { // backoff e continua (não perde o que já varreu)
          await sleep(8000);
          state.items.push({ name: e.name, hash: e.searchName, qty: e.qty, kind: e.kind, error: 'rate-limited' });
        } else {
          state.items.push({ name: e.name, hash: e.searchName, qty: e.qty, kind: e.kind, error: err.message });
        }
      }
      state.done++;
      await sleep(SCAN_DELAY_MS);
    }
    // ordena por valor de venda na hora (maxBuy*qty desc); sem comprador vai pro fim
    state.items.sort((a, b) => (b.subtotalCents || 0) - (a.subtotalCents || 0) || (b.buyCount || 0) - (a.buyCount || 0));
    state.status = 'done';
    log(`VARREDURA FIEL OK: ${state.total} nomes, ${state.symbol}${(state.totalImediatoCents/100).toFixed(2)} em ordens de compra`);
  } catch (err) {
    state.status = 'error'; state.error = err.message;
    log(`VARREDURA FIEL ERRO: ${err.message}`);
  }
}

function apiStashScan(q) {
  const appid = Number(q.get('appid')) || DEFAULT_APPID;
  const action = q.get('action') || 'status';
  if (!tbhSave.saveExists()) return { found: false };
  const cur = scans.get(appid);
  if (action === 'start') {
    if (!cur || cur.status !== 'running') runStashScan(appid); // dispara em background (sem await)
    const s = scans.get(appid);
    return { found: true, status: s.status, total: s.total, done: s.done };
  }
  // status/poll
  if (!cur) return { found: true, status: 'idle', total: 0, done: 0, items: [] };
  return { found: true, status: cur.status, total: cur.total, done: cur.done,
    currency: cur.currency, symbol: cur.symbol, totalImediatoCents: cur.totalImediatoCents,
    items: cur.status === 'running' ? [] : cur.items, error: cur.error };
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
    if (u.pathname === '/__gsm-ping') return send(200, 'giba-steam-market', 'text/plain');
    if (u.pathname === '/api/items') return send(200, await apiItems(u.searchParams));
    if (u.pathname === '/api/price') return send(200, await apiPrice(u.searchParams));
    if (u.pathname === '/api/orderbook') {
      const appid = Number(u.searchParams.get('appid')) || DEFAULT_APPID;
      const name = u.searchParams.get('name');
      if (!name) throw new Error('name obrigatorio');
      return send(200, await fetchOrderbook(appid, name));
    }
    if (u.pathname === '/api/stash-orders') return send(200, await apiStashOrders(u.searchParams));
    if (u.pathname === '/api/stash-prices') return send(200, await apiStashPrices(u.searchParams));
    if (u.pathname === '/api/stash-scan') return send(200, apiStashScan(u.searchParams));
    if (u.pathname === '/api/save-mtime') {
      // poll leve pro front detectar drop/venda no jogo e re-ler o baú sozinho
      return send(200, { mtime: tbhSave.saveExists() ? tbhSave.saveMtime() : 0 });
    }
    if (u.pathname === '/api/stash') {
      // só TBH tem leitura de save; outros appids retornam "não suportado"
      const appid = Number(u.searchParams.get('appid')) || DEFAULT_APPID;
      const force = u.searchParams.get('refresh') === '1';
      if (appid !== DEFAULT_APPID) return send(200, { supported: false });
      if (!tbhSave.saveExists()) {
        logThrottled('stash:no-save', 'BAU: save do TBH nao encontrado. Abra o jogo uma vez e depois clique Atualizar.', 60_000);
        return send(200, { supported: true, found: false });
      }
      const market = readListCache(appid);
      if (!market) {
        logThrottled('stash:need-market', 'BAU: save encontrado; aguardando a lista de precos do Mercado Steam carregar.', 30_000);
        return send(200, { supported: true, found: true, needItems: true });
      }
      // cache do baú invalidado pelo mtime do save: mesmo save = mesma resposta (determinístico).
      const mtime = tbhSave.saveMtime();
      const hit = stashCache.get(appid);
      if (!force && hit && hit.saveMtime === mtime) {
        return send(200, { supported: true, found: true, cached: true, ...hit.data });
      }
      const stash = tbhSave.readStash(market.items);
      stashCache.set(appid, { at: Date.now(), saveMtime: mtime, data: stash });
      logStashSummary(stash);
      return send(200, { supported: true, found: true, ...stash });
    }
    send(404, { error: 'not found' });
  } catch (e) {
    log(`ERRO ${u.pathname}: ${e.message}`);
    send(e.code === 429 ? 429 : 500, { error: e.message });
  }
});

// O Windows reserva faixas de portas pro Hyper-V/WSL (netsh excludedportrange).
// Se a 5260 cair numa faixa dessas, listen falha com EACCES sem o app ter culpa —
// então tentamos as portas seguintes em vez de morrer com "acesso negado".
const MAX_PORT_TRIES = 20;

function openBrowser(url) {
  if (process.env.GSM_OPEN !== '1') return;
  try {
    const cmd = process.env.COMSPEC || 'cmd.exe';
    const child = spawn(cmd, ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); // ENOENT chega async; sem handler, derruba o processo
    child.unref();
  } catch {}
}

async function isOurInstance(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__gsm-ping`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.text()) === 'giba-steam-market';
  } catch { return false; }
}

function tryListen(port, triesLeft) {
  server.once('error', async (err) => {
    if (err.code === 'EADDRINUSE' && await isOurInstance(port)) {
      log(`Ja tem uma instancia rodando em http://localhost:${port} — abrindo o navegador nela.`);
      openBrowser(`http://localhost:${port}`);
      return process.exit(0);
    }
    if ((err.code === 'EACCES' || err.code === 'EADDRINUSE') && triesLeft > 0) {
      log(`Porta ${port} indisponivel (${err.code}) — tentando ${port + 1}...`);
      server.removeAllListeners('listening'); // o callback do listen que falhou fica pendurado
      return tryListen(port + 1, triesLeft - 1);
    }
    log(`ERRO FATAL ao abrir porta (${err.code}: ${err.message}). Rode com outra porta: set GSM_PORT=5300 e abra o .bat de novo.`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    if (port !== PORT) log(`Porta ${PORT} estava bloqueada/ocupada pelo Windows — usando ${port} no lugar.`);
    log(`Giba Steam Market ON → ${url} (default appid ${DEFAULT_APPID})`);
    openBrowser(url);
  });
}

tryListen(PORT, MAX_PORT_TRIES);
