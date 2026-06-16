// tbh-save.mjs — leitura READ-ONLY do baú do TBH: Task Bar Hero
// NÃO escreve no save, NÃO toca o processo do jogo, NÃO modifica nada.
// Só decifra uma cópia em memória do SaveFile_Live.es3 e cruza com a tabela de itens do jogo.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const SAVE_DIR = path.join(os.homedir(), 'AppData/LocalLow/TesseractStudio/TaskbarHero');
const SAVE_FILE = path.join(SAVE_DIR, 'SaveFile_Live.es3');
const SAVE_NAMES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), 'data');
// Senha de descriptografia do save (Easy Save 3). NÃO é segredo do usuário — é uma chave do JOGO,
// guardada em texto plano dentro dos assets do TBH. A gente extrai sozinho (à prova de updates).
// Pode forçar via env TBH_ES3_PASSWORD se a auto-extração falhar.
let _es3pw = null;
function getES3Password() {
  if (process.env.TBH_ES3_PASSWORD) return process.env.TBH_ES3_PASSWORD;
  if (_es3pw) return _es3pw;
  const dir = findGameDataDir();
  // a chave fica em resources.assets logo após "ES3Defaults ... SaveFile_Live.es3 <CHAVE>"
  for (const f of ['resources.assets', 'sharedassets0.assets', 'globalgamemanagers.assets']) {
    try {
      const t = fs.readFileSync(path.join(dir, f), 'latin1');
      const m = t.match(/ES3Defaults[\s\S]{0,80}?SaveFile_Live\.es3[^\x21-\x7e]+([\x21-\x7e]{8,40})/);
      if (m) { _es3pw = m[1]; return _es3pw; }
    } catch {}
  }
  // fallback: chave conhecida na versão atual do jogo (re-extrair se o jogo atualizar)
  return 'emuMqG3bLYJ938ZDCfieWJ';
}

// Descobre a pasta de instalação do TBH varrendo as bibliotecas Steam de qualquer drive.
// Funciona pra todo mundo (a Steam de cada um está num lugar) — não hardcoda o PC do dev.
function findGameDataDir() {
  if (process.env.TBH_GAME_DIR && fs.existsSync(process.env.TBH_GAME_DIR)) return process.env.TBH_GAME_DIR;
  const rel = 'steamapps/common/TaskbarHero/TaskBarHero_Data';
  const roots = [];
  // raízes comuns de instalação Steam por drive
  for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
    roots.push(`${drive}:/Steam`, `${drive}:/SteamLibrary`, `${drive}:/Program Files (x86)/Steam`, `${drive}:/Games/Steam`);
  }
  for (const r of roots) { const p = path.join(r, rel); if (fs.existsSync(p)) return p; }
  return null;
}
const ASSET_CANDIDATES = (() => { const d = findGameDataDir(); return d ? [path.join(d, 'sharedassets0.assets')] : []; })();

const GRADE_MAP = { DIVINE:'Divine', ARCANA:'Arcana', IMMORTAL:'Immortal', LEGENDARY:'Legendary', BEYOND:'Beyond', EPIC:'Epic', RARE:'Rare' };

function decryptES3(buf, password) {
  const iv = buf.subarray(0, 16);
  const data = buf.subarray(16);
  const key = crypto.pbkdf2Sync(password, iv, 100, 16, 'sha1');
  const dec = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let out = Buffer.concat([dec.update(data), dec.final()]);
  if (out[0] === 0x1f && out[1] === 0x8b) out = zlib.gunzipSync(out);
  return out;
}

// Tabela mestra de itens do jogo: ItemKey -> { GRADE, GEARTYPE, Level, IsCanExchangeMarketable, ... }
let _itemTable = null;
function loadItemTable() {
  if (_itemTable) return _itemTable;
  // 1) usa cache gerado por scripts/extract-tbh-tables.mjs se existir (rápido)
  const cacheP = path.join(SAVE_NAMES_DIR, 'tbh-itemtable.json');
  if (fs.existsSync(cacheP)) {
    try { const arr = JSON.parse(fs.readFileSync(cacheP, 'utf8')); _itemTable = {}; for (const r of arr) _itemTable[r.ItemKey] = r; return _itemTable; } catch {}
  }
  // 2) senão extrai direto dos assets do jogo (texto plano, sem Python)
  const assetPath = ASSET_CANDIDATES.find(p => fs.existsSync(p));
  if (!assetPath) throw new Error('assets do TBH não encontrados (jogo instalado em outra pasta? defina TBH_GAME_DIR)');
  const t = fs.readFileSync(assetPath, 'latin1');
  const hdr = 'ItemKey,ITEMTYPE,GRADE,PARTS,GEARTYPE,GearGroup,ItemSynthesisType,NameKey,DescriptionKey,GearKey,DropKey,DropCooldown,Level,IsSteamItem,IconPath,IsDeletedInServer,IsCanExchangeMarketable';
  const start = t.indexOf(hdr);
  if (start < 0) throw new Error('tabela de itens não encontrada nos assets');
  let e = start;
  while (e < t.length) { const c = t.charCodeAt(e); if ((c >= 0x20 && c <= 0x7e) || c === 10 || c === 13) e++; else break; }
  const lines = t.slice(start, e).split(/\r?\n/).filter(l => l.trim());
  const cols = lines[0].split(',');
  const map = {};
  for (const line of lines.slice(1)) {
    const p = line.split(',');
    if (!/^\d+$/.test(p[0])) continue;
    const o = {}; cols.forEach((c, i) => o[c] = p[i]);
    map[p[0]] = o;
  }
  _itemTable = map;
  return map;
}

// Índice do mercado por (GEARTYPE|GRADE|Level) -> item (equipamentos).
function buildMarketIndex(marketItems) {
  const idx = {};
  for (const m of marketItems) {
    const tm = m.type && m.type.match(/^(\w+)\s*-\s*Lv\.?\s*(\d+)/);
    const gm = (m.name.match(/\((\w+)\)/) || [])[1];
    if (tm && gm) idx[`${tm[1]}|${gm}|${tm[2]}`.toUpperCase()] = m;
  }
  return idx;
}

// Índice do mercado por nome lowercase (materiais têm nome próprio: "Void Iron", "Phoenix Ash"...).
function buildMarketByName(marketItems) {
  const idx = {};
  for (const m of marketItems) idx[m.name.toLowerCase()] = m;
  return idx;
}

// ItemKey -> nome localizado (materiais). Gerado por scripts/extract-tbh-tables.mjs.
let _itemNames = null;
function loadItemNames() {
  if (_itemNames) return _itemNames;
  const p = path.join(SAVE_NAMES_DIR, 'tbh-itemnames.json');
  try { _itemNames = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { _itemNames = {}; }
  return _itemNames;
}

// [Correção de identidade dos itens] IDs de item no save são inteiros de 64 bits (18 dígitos).
// JSON.parse os lê como float64, que só tem ~15-16 dígitos de precisão — IDs DISTINTOS colidem no
// mesmo valor arredondado (ex: ...262742 e ...262763 viram ...262700). Resultado: o byId perdia
// itens (ex: 70 viravam 40) e casava slots com o item ERRADO (nome/preço trocados). Este reviver
// mantém todo inteiro grande como STRING, preservando a identidade exata. (context.source: Node 21+.)
const bigIntReviver = (k, v, ctx) =>
  (typeof v === 'number' && ctx && typeof ctx.source === 'string' && /^-?\d{16,}$/.test(ctx.source)) ? ctx.source : v;
const parseSave = s => JSON.parse(s, bigIntReviver);
const asArr = v => (typeof v === 'string' ? parseSave(v) : v);

// O reviver depende do 3º arg (context.source), que só existe no Node 21+. Sem ele os IDs grandes
// voltariam a colidir e o baú sairia errado SILENCIOSAMENTE — então detectamos e falhamos explícito.
const JSON_SOURCE_OK = (() => { let ok = false; try { JSON.parse('1234567890123456789', (k, v, ctx) => { if (ctx && typeof ctx.source === 'string') ok = true; return v; }); } catch {} return ok; })();

export function saveExists() { return fs.existsSync(SAVE_FILE); }
export function saveMtime() { try { return fs.statSync(SAVE_FILE).mtimeMs; } catch { return 0; } }

// Lê o baú e devolve itens agregados por nome de mercado, com preço e total.
// marketItems = array do cache /api/items (pra cruzar preço).
export function readStash(marketItems) {
  if (!saveExists()) throw new Error('save do TBH não encontrado');
  if (!JSON_SOURCE_OK) throw new Error('Node 21+ necessário (a leitura precisa de JSON.parse com context.source pra preservar os IDs de 64 bits do save). Atualize o Node.');
  const buf = fs.readFileSync(SAVE_FILE);
  // parseSave (não JSON.parse) pra preservar os IDs int64 — ver bigIntReviver acima
  const root = parseSave(decryptES3(buf, getES3Password()).toString('utf8'));
  const psd = parseSave(root.PlayerSaveData.value);

  const items = asArr(psd.itemSaveDatas);
  // chaveia por String(UniqueId): usar o número (arredondado pelo float64) como chave colidia itens
  const byId = {}; for (const it of items) byId[String(it.UniqueId)] = it;
  // [Inventário completo] ANTES lia só stash + inventory, deixando de fora itens que você possui:
  //  - equipados nos heróis (heroSaveDatas[].equippedItemIds) — em geral o gear MAIS valioso
  //  - a trading stash (tradingStashSaveDatas)
  // AGORA inclui os quatro locais; cada slot carrega de onde veio (where) pro subtotal por local.
  const equippedSlots = [];
  for (const h of (asArr(psd.heroSaveDatas) || [])) {
    for (const id of (h.equippedItemIds || [])) equippedSlots.push({ ItemUniqueId: id, where: 'equipped' });
  }
  const slots = [
    ...asArr(psd.stashSaveDatas).map(s => ({ ...s, where: 'stash' })),
    ...asArr(psd.inventorySaveDatas).map(s => ({ ...s, where: 'inventory' })),
    ...asArr(psd.tradingStashSaveDatas).map(s => ({ ...s, where: 'trading' })),
    ...equippedSlots,
  ].filter(s => s.ItemUniqueId && String(s.ItemUniqueId) !== '0');

  const table = loadItemTable();
  const names = loadItemNames();
  const mkidx = buildMarketIndex(marketItems);
  const mkByName = buildMarketByName(marketItems);

  const agg = {}; // marketHash -> { name, priceCents, qty, equippedQty, kind }
  let totalCents = 0, gearCents = 0, matCents = 0, priced = 0, unpriced = 0;
  const locationCents = { stash: 0, inventory: 0, equipped: 0, trading: 0 }; // subtotal por local
  const unknown = {};

  for (const slot of slots) {
    const it = byId[String(slot.ItemUniqueId)];
    if (!it) continue;
    const r = table[it.ItemKey];
    let m = null, kind = null;
    // 1) equipamento: casa por (geartype|grade|level)
    if (r && r.GEARTYPE && r.Level) { m = mkidx[`${r.GEARTYPE}|${r.GRADE}|${r.Level}`.toUpperCase()]; kind = 'gear'; }
    // 2) material: casa por nome localizado
    if (!m) { const nm = names[it.ItemKey]; if (nm) { m = mkByName[nm.toLowerCase()]; if (m) kind = 'material'; } }
    if (m) {
      const k = m.hash;
      if (!agg[k]) agg[k] = { name: m.name, hash: m.hash, priceCents: m.priceCents, priceText: m.priceText, type: m.type, icon: m.icon, color: m.color, url: m.url, qty: 0, equippedQty: 0, kind };
      agg[k].qty++;
      if (slot.where === 'equipped') agg[k].equippedQty++; // pra UI marcar item equipado
      totalCents += m.priceCents; priced++;
      if (slot.where in locationCents) locationCents[slot.where] += m.priceCents;
      if (kind === 'material') matCents += m.priceCents; else gearCents += m.priceCents;
    } else {
      unpriced++;
      const nm = names[it.ItemKey];
      const label = nm || (r ? `${r.GEARTYPE || r.ITEMTYPE} ${r.GRADE} Lv${r.Level}`.trim() : `ItemKey ${it.ItemKey}`);
      unknown[label] = (unknown[label] || 0) + 1;
    }
  }

  const list = Object.values(agg).sort((a, b) => b.priceCents * b.qty - a.priceCents * a.qty);
  return {
    fetchedAt: Date.now(),
    saveMtime: saveMtime(),
    totalCents,
    gearCents,
    matCents,
    locationCents,
    totalItems: slots.length,
    pricedItems: priced,
    unpricedItems: unpriced,
    types: list.length,
    items: list,
    unknownSummary: Object.entries(unknown).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => ({ label: k, qty: n })),
  };
}
