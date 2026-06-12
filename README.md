# 🎒 Giba Steam Market

**Descubra quanto vale o seu baú no TBH: Task Bar Hero — sem abrir a Steam.**

Um app que roda no seu PC e mostra:

- 💰 **O valor total do seu inventário** (equipamentos + materiais), lido direto do save do jogo. Você não digita nada.
- 🔎 **Os preços do Mercado da Steam** de todos os itens, do mais caro pro mais barato, com busca instantânea.
- 🪙 Preço em **dólar e em real (R$)**.

Feito por **[EuSouOGiba](https://eusouogiba.com)** · [youtube.com/@eusouogiba](https://youtube.com/@eusouogiba)

![demo](docs/demo.png)

---

## ✅ É seguro? Vou tomar ban?

**Não.** Esse app **só LÊ arquivos** que já estão no seu computador. Ele:

- ✅ Lê uma **cópia** do save do jogo (na memória) só pra calcular o valor.
- ✅ Usa os mesmos endereços públicos de preço que o site da Steam usa.
- ❌ **NÃO** modifica o seu save.
- ❌ **NÃO** mexe no jogo enquanto ele roda (não injeta nada, não trapaceia).
- ❌ **NÃO** automatiza compra/venda.
- ❌ **NÃO** envia seus dados pra lugar nenhum (roda 100% no seu PC).

Ban acontece quando alguém **modifica** o save pra trapacear ou automatiza trocas. Nada disso é feito aqui. É leitura passiva, como abrir o arquivo no Bloco de Notas.

> ⚠️ Ainda assim, use por sua conta e risco. Este é um projeto da comunidade, sem vínculo com a Valve ou com os criadores do TBH.

---

## 🚀 Como instalar (passo a passo pra quem nunca programou)

### Passo 1 — Instalar o Node.js

O app precisa do **Node.js** (um programa gratuito que roda o código).

1. Acesse 👉 **https://nodejs.org**
2. Baixe a versão **"LTS"** (o botão verde da esquerda).
3. Instale clicando "Avançar / Next" até o fim.

### Passo 2 — Baixar este app

- Clique no botão verde **"Code"** aqui em cima nesta página → **"Download ZIP"**.
- Extraia o ZIP numa pasta fácil, ex: `C:\giba-steam-market`.

### Passo 3 — Abrir e rodar

1. Entre na pasta que você extraiu.
2. **Dê dois cliques** no arquivo **`start-steam-market.bat`**.
3. Vai abrir uma janela preta (é normal!) e o app abre sozinho no seu navegador.

Pronto! 🎉 O seu baú aparece preenchido automaticamente.

> Da próxima vez, é só dar dois cliques no `start-steam-market.bat` de novo.

---

## 🆘 Deu erro? (problemas comuns)

| Problema | Solução |
|---|---|
| **"Acesso Negado" ao abrir o .bat** | Veja a seção **"Acesso Negado — o que fazer"** logo abaixo. |
| **"Acesso negado" / não conecta na porta 5260** | Atualize pra versão mais nova do app: agora ele escolhe outra porta sozinho quando o Windows bloqueia a 5260 e abre o navegador no endereço certo. |
| "O Windows protegeu o seu computador" (tela azul do SmartScreen) | Aviso padrão pra qualquer .bat baixado da internet. Clique em **"Mais informações" → "Executar assim mesmo"**. |
| "node não é reconhecido" | Você não instalou o Node.js (Passo 1) ou precisa **reiniciar o PC** depois de instalar. |
| "save do TBH não encontrado" | Abra o TBH pelo menos uma vez pra ele criar o save. |
| "assets do TBH não encontrados" | O jogo está instalado num lugar diferente. Veja **"Steam em outra pasta"** abaixo. |
| Os nomes dos materiais não aparecem | Normal! Os nomes dos materiais são opcionais — veja a seção **"Mostrar nomes dos materiais"**. |
| A página não abre | Olhe a janela preta: ela mostra o endereço real (ex: `http://localhost:5260` ou outra porta). Digite esse endereço no navegador. |

### 🔒 "Acesso Negado" — o que fazer

Esse erro tem 2 causas possíveis, e o app novo já te avisa qual é a sua:

**Causa 1 — Rodou o .bat de dentro do ZIP, sem extrair.**
O Windows abre o ZIP como se fosse pasta, mas não é. Clique com o botão direito no ZIP → **"Extrair Tudo..."** → entre na pasta extraída → rode o `.bat` de lá.

**Causa 2 — A pasta é protegida pelo Windows.**
Pastas como `Arquivos de Programas`, a raiz do `C:\` ou pastas vigiadas pelo antivírus/OneDrive não deixam o app gravar o cache. **Mova a pasta inteira do app** pra `Documentos` ou pra `C:\giba-steam-market` e rode de lá.

**E o "acesso negado" na porta 5260?**
O Windows reserva faixas de portas pra recursos internos (Hyper-V/WSL), e em alguns PCs a 5260 cai numa faixa reservada — não é firewall nem configuração sua. A versão atual do app detecta isso e **pula automaticamente pra próxima porta livre** (5261, 5262…), abrindo o navegador já no endereço certo. Se você baixou o app antes dessa correção, baixe o ZIP de novo. Pra forçar uma porta manualmente:

```bat
set GSM_PORT=5300
start-steam-market.bat
```

### Steam em outra pasta

O app procura o TBH automaticamente nos drives C, D, E… Se você instalou em um lugar incomum, descubra a pasta `TaskBarHero_Data` (clique direito no jogo na Steam → Gerenciar → Procurar arquivos locais) e rode assim, trocando o caminho:

```bat
set TBH_GAME_DIR=D:\MinhaPasta\TaskbarHero\TaskBarHero_Data
start-steam-market.bat
```

---

## 🔩 Mostrar os nomes dos materiais (opcional)

Os **equipamentos** (espadas, armaduras) já aparecem com preço sem configurar nada.

Os **materiais** (Void Iron, Phoenix Ash…) têm nome próprio guardado de forma compactada no jogo. Pra destravar os nomes deles, rode uma vez:

1. Instale o Python: 👉 https://www.python.org/downloads (marque "Add Python to PATH" na instalação).
2. Abra a janela preta na pasta do app e rode:
   ```bat
   pip install UnityPy
   npm run extract-tables
   ```
3. Reinicie o app. Agora os materiais aparecem com nome e preço também.

Sem isso, o app funciona normal — só não soma os materiais que têm nome próprio.

---

## 🎮 Funciona com outros jogos da Steam?

Sim! No topo do app tem um seletor de jogo (CS2, TF2, Dota 2, Rust, ou qualquer AppID). Pra esses, a **lista de preços e a busca** funcionam. O **baú automático** é exclusivo do TBH (cada jogo guarda o save de um jeito).

---

## 🤖 Vai usar uma IA (ChatGPT, Claude) pra te ajudar?

Se você não entende de código e quer que uma IA te ajude a instalar, modificar ou consertar este app, **mostre pra ela o arquivo [`AI-SETUP.md`](AI-SETUP.md)**. Ele explica pra IA exatamente como o sistema funciona e como se comportar pra não quebrar nada (nem te colocar em risco).

---

## 🛠️ Pra quem é técnico

- **Stack:** Node puro (sem dependências), servidor HTTP + UI HTML única. Python+UnityPy só pra extrair nomes de materiais (opcional).
- **Preços:** endpoints públicos `steamcommunity.com/market/search/render` e `/priceoverview`, com throttle e cache em disco.
- **Save:** Easy Save 3 (AES-128-CBC, PBKDF2-SHA1). A chave fica em texto plano nos assets do jogo e é auto-extraída.
- **Mapeamento item→preço:** tabela mestra dos assets (`ItemKey → grade/tipo/nível`) casa com o `type` do mercado; materiais via localização Unity.
- Detalhes em [`AI-SETUP.md`](AI-SETUP.md).

---

## 📄 Licença

MIT — use, modifique e compartilhe à vontade. Se ajudar, deixa uma estrela ⭐ e se inscreve no canal!

**EuSouOGiba** · [youtube.com/@eusouogiba](https://youtube.com/@eusouogiba) · [eusouogiba.com](https://eusouogiba.com)
