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
const ITEM_TABLE_REQUIRED_COLUMNS = [
  'ItemKey',
  'ITEMTYPE',
  'GRADE',
  'GEARTYPE',
  'NameKey',
  'Level',
  'IsSteamItem',
  'IconPath',
  'IsCanExchangeMarketable',
];

function decryptES3(buf, password) {
  const iv = buf.subarray(0, 16);
  const data = buf.subarray(16);
  const key = crypto.pbkdf2Sync(password, iv, 100, 16, 'sha1');
  const dec = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let out = Buffer.concat([dec.update(data), dec.final()]);
  if (out[0] === 0x1f && out[1] === 0x8b) out = zlib.gunzipSync(out);
  return out;
}

function readAsciiBlock(text, start) {
  let end = start;
  while (end < text.length) {
    const c = text.charCodeAt(end);
    if ((c >= 0x20 && c <= 0x7e) || c === 10 || c === 13 || c === 9) end++;
    else break;
  }
  return text.slice(start, end);
}

function parseItemTableText(text) {
  const headerStart = text.indexOf('ItemKey,ITEMTYPE,');
  if (headerStart < 0) return null;
  const block = readAsciiBlock(text, headerStart);
  const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const cols = lines[0].split(',').map(c => c.trim());
  if (!ITEM_TABLE_REQUIRED_COLUMNS.every(c => cols.includes(c))) return null;

  const map = {};
  for (const line of lines.slice(1)) {
    const parts = line.split(',');
    if (!/^\d+$/.test(parts[0] || '')) continue;
    const row = {};
    cols.forEach((c, i) => row[c] = parts[i] || '');
    map[row.ItemKey] = row;
  }
  return Object.keys(map).length ? map : null;
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
  const map = parseItemTableText(t);
  if (!map) throw new Error('tabela de itens não encontrada nos assets do TBH; atualize o app ou rode npm run extract-tables');
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

const asArr = v => (typeof v === 'string' ? JSON.parse(v) : v);

export function saveExists() { return fs.existsSync(SAVE_FILE); }
export function saveMtime() { try { return fs.statSync(SAVE_FILE).mtimeMs; } catch { return 0; } }

// Lê o baú e devolve itens agregados por nome de mercado, com preço e total.
// marketItems = array do cache /api/items (pra cruzar preço).
export function readStash(marketItems) {
  if (!saveExists()) throw new Error('save do TBH não encontrado');
  const buf = fs.readFileSync(SAVE_FILE);
  const root = JSON.parse(decryptES3(buf, getES3Password()).toString('utf8'));
  const psd = JSON.parse(root.PlayerSaveData.value);

  const items = asArr(psd.itemSaveDatas);
  const byId = {}; for (const it of items) byId[it.UniqueId] = it;
  const slots = [
    ...asArr(psd.stashSaveDatas).map(s => ({ ...s, where: 'stash' })),
    ...asArr(psd.inventorySaveDatas).map(s => ({ ...s, where: 'inventory', ItemUniqueId: s.ItemUniqueId })),
  ].filter(s => s.ItemUniqueId && String(s.ItemUniqueId) !== '0');

  const table = loadItemTable();
  const names = loadItemNames();
  const mkidx = buildMarketIndex(marketItems);
  const mkByName = buildMarketByName(marketItems);

  const agg = {}; // marketHash -> { name, priceCents, qty, kind }
  let totalCents = 0, gearCents = 0, matCents = 0, priced = 0, unpriced = 0;
  const unknown = {};

  for (const slot of slots) {
    const it = byId[slot.ItemUniqueId];
    if (!it) continue;
    const r = table[it.ItemKey];
    let m = null, kind = null;
    // 1) equipamento: casa por (geartype|grade|level)
    if (r && r.GEARTYPE && r.Level) { m = mkidx[`${r.GEARTYPE}|${r.GRADE}|${r.Level}`.toUpperCase()]; kind = 'gear'; }
    // 2) material: casa por nome localizado
    if (!m) { const nm = names[it.ItemKey]; if (nm) { m = mkByName[nm.toLowerCase()]; if (m) kind = 'material'; } }
    if (m) {
      const k = m.hash;
      if (!agg[k]) agg[k] = { name: m.name, hash: m.hash, priceCents: m.priceCents, priceText: m.priceText, type: m.type, icon: m.icon, color: m.color, url: m.url, qty: 0, kind };
      agg[k].qty++;
      totalCents += m.priceCents; priced++;
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
    totalItems: slots.length,
    pricedItems: priced,
    unpricedItems: unpriced,
    types: list.length,
    items: list,
    unknownSummary: Object.entries(unknown).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => ({ label: k, qty: n })),
  };
}
