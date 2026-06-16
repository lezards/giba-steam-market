// extract-tbh-tables.mjs — regenera as tabelas do TBH a partir dos assets do jogo.
// Rode quando o TBH atualizar e os preços/nomes saírem do lugar:
//   node scripts/extract-tbh-tables.mjs
// Gera data/tbh-itemtable.json (ItemKey→grade/tipo/nível) e data/tbh-itemnames.json (ItemKey→nome).
// A parte de nomes (localização) precisa de Python + UnityPy: pip install UnityPy
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data');

// [Suporte Linux] Raízes de biblioteca Steam, agora multiplataforma (mesma lógica do tbh-save.mjs).
// ANTES: o findGameDir() só varria drives Windows → no Linux não achava o jogo e a extração de
// tabelas (npm run extract-tables) morria com "TBH não encontrado".
// AGORA: Windows (drives) + Linux (~/.local/share/Steam, ~/.steam, flatpak) + libraryfolders.vdf.
function steamLibraries() {
  const home = os.homedir();
  const roots = [
    path.join(home, '.local/share/Steam'),
    path.join(home, '.steam/steam'),
    path.join(home, '.steam/root'),
    path.join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam'), // flatpak
  ];
  for (const drive of ['C', 'D', 'E', 'F', 'G', 'H']) {
    roots.push(`${drive}:/Steam`, `${drive}:/SteamLibrary`, `${drive}:/Program Files (x86)/Steam`, `${drive}:/Games/Steam`);
  }
  const libs = new Set(roots);
  for (const r of roots) {
    for (const vdf of [path.join(r, 'steamapps/libraryfolders.vdf'), path.join(r, 'config/libraryfolders.vdf')]) {
      try { const t = fs.readFileSync(vdf, 'utf8'); for (const m of t.matchAll(/"path"\s*"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\')); } catch {}
    }
  }
  return [...libs];
}
// Descobre a pasta do TBH (Windows nativo ou instalação Proton/Linux).
function findGameDir() {
  if (process.env.TBH_GAME_DIR && fs.existsSync(process.env.TBH_GAME_DIR)) return process.env.TBH_GAME_DIR;
  const rel = 'steamapps/common/TaskbarHero/TaskBarHero_Data';
  for (const r of steamLibraries()) { const p = path.join(r, rel); try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}
const gameDir = findGameDir();
if (!gameDir) { console.error('TBH não encontrado. Defina TBH_GAME_DIR=<pasta>\\TaskBarHero_Data'); process.exit(1); }

// 1) tabela mestra (texto plano em sharedassets0.assets)
const t = fs.readFileSync(path.join(gameDir, 'sharedassets0.assets'), 'latin1');
// [Robustez vs update do jogo] prefixo estável do cabeçalho (mesmo motivo do tbh-save.mjs):
// um update adicionou a coluna IsBucketBox e o match do cabeçalho inteiro passou a falhar.
const hdr = 'ItemKey,ITEMTYPE,GRADE,PARTS,GEARTYPE,GearGroup,ItemSynthesisType';
const s = t.indexOf(hdr);
let e = s; while (e < t.length) { const c = t.charCodeAt(e); if ((c >= 0x20 && c <= 0x7e) || c === 10 || c === 13) e++; else break; }
const lines = t.slice(s, e).split(/\r?\n/).filter(l => l.trim());
const cols = lines[0].split(',');
const tableMap = {};
for (const line of lines.slice(1)) { const p = line.split(','); if (!/^\d+$/.test(p[0])) continue; const o = {}; cols.forEach((c, i) => o[c] = p[i]); tableMap[p[0]] = o; }
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
// [Suporte Linux] Interpretador Python multiplataforma.
// ANTES: chamava só 'python' — no Linux o binário costuma ser 'python3' (ou nem existir), então a
// etapa de nomes (UnityPy) falhava. AGORA: TBH_PYTHON (ex: venv com UnityPy) → python3 → python.
const pythons = [process.env.TBH_PYTHON, 'python3', 'python'].filter(Boolean);
let done = false, lastErr;
for (const exe of pythons) {
  try { console.log(execFileSync(exe, ['-c', py], { encoding: 'utf8' }).trim()); done = true; break; }
  catch (err) { lastErr = err; }
}
if (!done) console.error('Nomes (UnityPy) falhou — instale UnityPy e aponte o interpretador via TBH_PYTHON, ou: pip install UnityPy\n', lastErr?.message);
