// extract-tbh-tables.mjs — regenera as tabelas do TBH a partir dos assets do jogo.
// Rode quando o TBH atualizar e os preços/nomes saírem do lugar:
//   node scripts/extract-tbh-tables.mjs
// Gera data/tbh-itemtable.json (ItemKey→grade/tipo/nível) e data/tbh-itemnames.json (ItemKey→nome).
// A parte de nomes (localização) precisa de Python + UnityPy: pip install UnityPy
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data');

// Descobre a pasta do TBH varrendo as bibliotecas Steam de qualquer drive (não hardcoda nenhum PC).
function findGameDir() {
  if (process.env.TBH_GAME_DIR && fs.existsSync(process.env.TBH_GAME_DIR)) return process.env.TBH_GAME_DIR;
  const rel = 'steamapps/common/TaskbarHero/TaskBarHero_Data';
  for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
    for (const root of [`${drive}:/Steam`, `${drive}:/SteamLibrary`, `${drive}:/Program Files (x86)/Steam`, `${drive}:/Games/Steam`]) {
      const p = path.join(root, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
const gameDir = findGameDir();
if (!gameDir) { console.error('TBH não encontrado. Defina TBH_GAME_DIR=<pasta>\\TaskBarHero_Data'); process.exit(1); }

// 1) tabela mestra (texto plano em sharedassets0.assets)
const t = fs.readFileSync(path.join(gameDir, 'sharedassets0.assets'), 'latin1');
const s = t.indexOf('ItemKey,ITEMTYPE,');
if (s < 0) {
  console.error('Tabela de itens não encontrada em sharedassets0.assets.');
  process.exit(1);
}
let e = s; while (e < t.length) { const c = t.charCodeAt(e); if ((c >= 0x20 && c <= 0x7e) || c === 10 || c === 13 || c === 9) e++; else break; }
const lines = t.slice(s, e).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const cols = lines[0].split(',').map(c => c.trim());
for (const col of ['ItemKey', 'ITEMTYPE', 'GRADE', 'GEARTYPE', 'NameKey', 'Level', 'IsSteamItem', 'IconPath', 'IsCanExchangeMarketable']) {
  if (!cols.includes(col)) {
    console.error(`Tabela de itens encontrada, mas sem coluna obrigatória: ${col}`);
    process.exit(1);
  }
}
const tableMap = {};
for (const line of lines.slice(1)) { const p = line.split(','); if (!/^\d+$/.test(p[0] || '')) continue; const o = {}; cols.forEach((c, i) => o[c] = p[i] || ''); tableMap[p[0]] = o; }
fs.writeFileSync(path.join(DATA, 'tbh-itemtable.json'), JSON.stringify(Object.values(tableMap)));
console.log('tbh-itemtable.json:', Object.keys(tableMap).length, 'itens');

// 2) nomes localizados (UnityPy via Python)
const py = `
import UnityPy, json, glob, re, sys
base=r'${gameDir.replace(/\\/g, '/')}/StreamingAssets/aa/StandaloneWindows64/'
shared={}
for f in glob.glob(base+'localization-assets-shared_assets_all.bundle'):
  for obj in UnityPy.load(f).objects:
    if obj.type.name=='MonoBehaviour':
      try: d=obj.read_typetree()
      except: continue
      for ent in (d.get('m_Entries') or []):
        if ent.get('m_Key'): shared[ent['m_Key']]=ent['m_Id']
loc={}
for f in glob.glob(base+'localization-string-tables-english*.bundle'):
  for obj in UnityPy.load(f).objects:
    if obj.type.name=='MonoBehaviour':
      try: d=obj.read_typetree()
      except: continue
      for ent in (d.get('m_TableData') or []):
        if ent.get('m_Localized'): loc[str(ent['m_Id'])]=ent['m_Localized']
out={}
for key,mid in shared.items():
  m=re.match(r'ItemName_(\\d+)',key)
  if m and str(mid) in loc: out[m.group(1)]=loc[str(mid)]
json.dump(out,open(r'${DATA.replace(/\\/g, '/')}/tbh-itemnames.json','w',encoding='utf8'),ensure_ascii=False)
print('tbh-itemnames.json:',len(out),'nomes')
`;
try {
  const r = execFileSync('python', ['-c', py], { encoding: 'utf8' });
  console.log(r.trim());
} catch (err) {
  console.error('Nomes (UnityPy) falhou — instale: pip install UnityPy\n', err.message);
}
