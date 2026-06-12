# 🤖 Guia para a IA (ChatGPT, Claude, Gemini, etc.)

> **Para o usuário:** se você é leigo e quer ajuda de uma IA pra instalar ou consertar este app,
> copie este arquivo inteiro e cole no chat da IA, dizendo:
> *"Me ajude a usar este projeto seguindo estas instruções."*

> **Para a IA:** o usuário provavelmente **não sabe programar**. Seja paciente, dê um passo de cada
> vez, espere ele confirmar antes de seguir, e nunca peça pra ele fazer algo perigoso. Leia tudo abaixo
> antes de instruir qualquer coisa.

---

## O que é este projeto

**Giba Steam Market** é um app local que mostra o valor do inventário ("baú") do jogo
**TBH: Task Bar Hero** (Steam AppID `3678970`) e os preços do Mercado da Comunidade Steam.

- Roda um servidor Node em `http://localhost:5260`.
- Lê o save do jogo (somente leitura) e os preços públicos da Steam.
- Tudo roda na máquina do usuário; nada é enviado pra fora.

---

## ⛔ REGRAS INVIOLÁVEIS (leia antes de agir)

1. **NUNCA escreva, edite, mova ou delete o save do jogo.** O save fica em:
   `%USERPROFILE%\AppData\LocalLow\TesseractStudio\TaskbarHero\SaveFile_Live.es3`.
   Este app só faz `readFileSync` numa cópia em memória. Se você for sugerir QUALQUER escrita nesse
   arquivo, **PARE** — isso pode dar ban no usuário. Não faça.
2. **NÃO automatize compra/venda na Steam, nem injete código no jogo, nem mexa na memória do processo.**
   Este projeto é estritamente *read-only*. Mantenha assim.
3. **NÃO suba dados do usuário pra lugar nenhum.** O arquivo `data/save-plain.json` (se existir) contém
   o inventário pessoal dele. Ele está no `.gitignore` — **nunca** remova essa linha, nunca commite esse
   arquivo, nunca cole o conteúdo dele em lugar público.
4. **NÃO peça pro usuário desativar antivírus, rodar como admin sem necessidade, ou colar tokens/senhas.**
5. Quando em dúvida entre uma solução que escreve em arquivos do jogo e uma que só lê, **escolha sempre
   a que só lê**.

---

## Como o sistema funciona (pra você diagnosticar)

```
Navegador (UI) ──> servidor Node (server.mjs, porta 5260)
                       ├── /api/items  → preços do Mercado Steam (cache em data/items-<appid>.json)
                       ├── /api/price  → preço em R$ de um item (Steam priceoverview)
                       └── /api/stash  → lê o save do TBH e calcula o valor do baú
                                          (módulo tbh-save.mjs)
```

**Fluxo do baú (`tbh-save.mjs`):**
1. Lê e descriptografa uma cópia do `SaveFile_Live.es3` (Easy Save 3 / AES). A senha é uma chave do
   **jogo**, em texto plano nos assets, e é extraída automaticamente. Não é segredo do usuário.
2. Lê a "tabela mestra" de itens dos assets do jogo (`sharedassets0.assets`): cada item tem
   `ItemKey → grade, tipo, nível, se é vendável`.
3. Cruza com os preços do Mercado:
   - **Equipamentos** casam por `(tipo|grade|nível)` — ex: "Sword" + "Immortal" + "Lv80".
   - **Materiais** casam por **nome** (ex: "Void Iron"), que vem da tabela de localização Unity
     (opcional, precisa de Python+UnityPy).

---

## Requisitos

- **Node.js 20+** — obrigatório. (`node --version` pra checar.)
- **TBH instalado** e aberto pelo menos uma vez (pra existir o save).
- **Python + UnityPy** — OPCIONAL, só pra mostrar o nome/preço dos materiais.

---

## Roteiro de instalação que você deve seguir com o usuário

1. Pergunte se ele tem o Node instalado: peça pra rodar `node --version`.
   - Se der erro, mande instalar de https://nodejs.org (versão LTS) e **reiniciar o PC**.
2. Peça pra ele dar dois cliques em `start-steam-market.bat` (ou rodar `npm start` na pasta).
3. Confirme que abriu `http://localhost:5260` e que o baú apareceu.
4. Se os materiais não tiverem nome, ofereça (opcional) instalar Python+UnityPy e rodar
   `npm run extract-tables`.

---

## Erros comuns e como resolver

| Sintoma | Causa | O que instruir |
|---|---|---|
| `node` não é reconhecido | Node não instalado / PATH | Instalar Node LTS, reiniciar o PC |
| `save do TBH não encontrado` | Save não existe | Abrir o jogo uma vez |
| `assets do TBH não encontrados` | Steam em pasta incomum | Definir `set TBH_GAME_DIR=<pasta>\TaskBarHero_Data` antes de iniciar |
| Porta 5260 ocupada ou `EACCES` | Outra instância rodando, ou porta dentro de faixa reservada do Windows (`netsh int ipv4 show excludedportrange protocol=tcp`) | O server tenta sozinho as 20 portas seguintes (5261…) e loga a escolhida; se já houver instância nossa rodando, só reabre o navegador nela. Forçar manualmente: `GSM_PORT` |
| "Acesso negado" ao iniciar o .bat | Pasta protegida (Program Files, OneDrive, antivírus) ou .bat rodado de dentro do ZIP | O launcher detecta os dois casos e imprime a solução; instruir mover a pasta pra `Documentos`/`C:\giba-steam-market` ou extrair o ZIP |
| Materiais sem nome | Falta tabela de localização | `pip install UnityPy` + `npm run extract-tables` (opcional) |
| Preço total parece errado | Steam respondeu em moeda da região | O app força USD (`country=US&currency=1`); apague `data/items-3678970.json` e reinicie pra repuxar |

---

## Se o jogo for atualizado e parar de funcionar

Uma atualização do TBH pode mudar a chave do save ou a tabela de itens. Para reextrair tudo:

```bat
npm run extract-tables
```

Se a senha do save (Easy Save 3) mudar e a auto-extração falhar, ela pode ser encontrada nos assets
do jogo procurando o texto `ES3Defaults` seguido de `SaveFile_Live.es3` — a chave vem logo depois,
em texto legível. Defina-a manualmente com `set TBH_ES3_PASSWORD=<chave>`.

---

## Variáveis de ambiente (configuração avançada)

| Variável | Para quê |
|---|---|
| `GSM_PORT` | Mudar a porta base (padrão 5260; se bloqueada/ocupada o server tenta as 20 seguintes) |
| `GSM_OPEN` | `1` = o server abre o navegador sozinho ao subir (o .bat já seta) |
| `TBH_GAME_DIR` | Apontar a pasta `TaskBarHero_Data` manualmente |
| `TBH_ES3_PASSWORD` | Forçar a senha do save se a auto-extração falhar |

---

## Limites importantes (não prometa isso ao usuário)

- O app **não vende nem compra** nada — só mostra preços. A venda é feita pelo usuário na Steam.
- Materiais que **não têm listagem** na Steam não entram no valor (não há preço pra eles — isso é correto).
- Os valores são **estimativas** do preço atual de venda; o mercado muda o tempo todo.

---

Feito por **EuSouOGiba** · youtube.com/@eusouogiba · eusouogiba.com
