# Middleware Chatwoot ⇄ WhatsApp (Z-API)

Conecta o WhatsApp ao seu Chatwoot self-hosted usando uma caixa de entrada do tipo **API**.
A Z-API (gateway não-oficial de WhatsApp) cuida da conexão com o celular; este middleware
faz a "tradução" entre os dois lados, nas duas direções.

```
   WhatsApp ──> Z-API ──(webhook "Ao receber")──> [MIDDLEWARE] ──> API do Chatwoot ──> Agente
   Agente ──> Chatwoot ──(webhook "message_created")──> [MIDDLEWARE] ──> Z-API send-* ──> WhatsApp
```

Suporta texto e mídia (imagem, áudio, vídeo, documento, localização e contato) nos dois sentidos.

---

## 1. Pré-requisitos

- VPS com o Chatwoot já rodando e acessível por **HTTPS** (a Z-API **só aceita webhooks HTTPS**).
- Conta na Z-API com uma **instância conectada** ao número de WhatsApp.
- Node.js 18+ **ou** Docker na VPS.
- Um subdomínio/caminho público com HTTPS para o middleware (ex.: `https://wpp.seudominio.com`),
  normalmente via Nginx/Traefik/Caddy como proxy reverso.

---

## 2. Configurar o Chatwoot

1. No Chatwoot, vá em **Configurações → Caixas de entrada → Adicionar caixa de entrada → API**.
   Dê um nome (ex.: "WhatsApp Z-API") e crie. Adicione os agentes.
2. Anote o **ID da caixa de entrada** (`CHATWOOT_INBOX_ID`). Ele aparece na URL ao abrir a
   caixa: `.../app/accounts/<ACCOUNT_ID>/settings/inboxes/<INBOX_ID>`.
3. Anote o **ID da conta** (`CHATWOOT_ACCOUNT_ID`), também presente na URL.
4. Gere o **Access Token** em **Perfil → Configurações → Token de acesso**
   (`CHATWOOT_API_ACCESS_TOKEN`).

> Use um usuário/agente dedicado para o token, pois as mensagens entram por ele.

---

## 3. Configurar a Z-API

No painel da Z-API, na sua instância, anote:

- **ID da instância** → `ZAPI_INSTANCE_ID`
- **Token da instância** → `ZAPI_INSTANCE_TOKEN`
- **Account Security Token** (em *Segurança → Token de conta*) → `ZAPI_CLIENT_TOKEN`
  (vai no header `Client-Token` de toda requisição; é obrigatório quando ativado).

Os webhooks serão configurados no passo 6, depois que o middleware estiver no ar.

---

## 4. Configurar o `.env`

```bash
cp .env.example .env
```

Preencha os valores. Gere um `WEBHOOK_TOKEN` aleatório e longo, por exemplo:

```bash
openssl rand -hex 24
```

Esse token entra na **URL** dos webhooks e funciona como senha — quem não souber a URL
completa recebe `401`.

---

## 5. Subir o middleware

### Opção A — Docker (recomendado)

```bash
docker compose up -d --build
docker compose logs -f
```

Se o Chatwoot roda na mesma VPS em Docker, descomente o bloco `networks` no
`docker-compose.yml`, conecte na mesma rede do Chatwoot e use a URL **interna** dele em
`CHATWOOT_BASE_URL` (ex.: `http://chatwoot-rails:3000`) — mais rápido e seguro.

### Opção B — Node direto

```bash
npm install
npm start            # ou: npm run dev  (reinicia ao salvar)
```

Para manter de pé em produção sem Docker, use PM2 ou um serviço systemd.

### Teste local

```bash
curl http://localhost:3333/health
# {"status":"ok","uptime":...}
```

---

## 6. Configurar os webhooks (os dois lados)

Coloque o middleware atrás do seu proxy HTTPS. Os endpoints são:

| Direção            | Método | Caminho                                  |
|--------------------|--------|------------------------------------------|
| WhatsApp → Chatwoot| POST   | `/webhooks/zapi/<WEBHOOK_TOKEN>`         |
| Chatwoot → WhatsApp| POST   | `/webhooks/chatwoot/<WEBHOOK_TOKEN>`     |

### 6.1 Z-API → middleware

No painel da Z-API, configure o webhook **"Ao receber"** (on-message-received) com a URL:

```
https://wpp.seudominio.com/webhooks/zapi/<WEBHOOK_TOKEN>
```

Deixe **desativada** a opção de notificar mensagens enviadas por você (a menos que queira
sincronizá-las e tenha entendido o risco de loop — veja `FORWARD_FROM_ME`).

### 6.2 Chatwoot → middleware

No Chatwoot, vá em **Configurações → Integrações → Webhooks → Adicionar novo webhook**:

- **URL:** `https://wpp.seudominio.com/webhooks/chatwoot/<WEBHOOK_TOKEN>`
- **Eventos:** marque **Message created** (`message_created`).

Pronto. Mande uma mensagem do WhatsApp para o número conectado: ela deve aparecer na caixa
"WhatsApp Z-API" do Chatwoot. Responda pelo Chatwoot: a resposta chega no WhatsApp.

---

## 7. Exemplo de proxy reverso (Nginx)

```nginx
location /webhooks/ {
    proxy_pass http://127.0.0.1:3333;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

(Garanta que o `server` esteja com certificado TLS válido — Let's Encrypt resolve.)

---

## 8. Ajustes de comportamento (`.env`)

- `FORWARD_FROM_ME` — encaminhar para o Chatwoot mensagens enviadas pelo próprio número.
  Padrão `false`. **Cuidado:** se ativar, evite que o Chatwoot reenvie (risco de loop).
- `IGNORE_GROUPS` — ignorar mensagens de grupos. Padrão `true`.
- `HANDLE_MEDIA` — baixar a mídia da Z-API e subir como anexo no Chatwoot. Padrão `true`.
  Se `false`, apenas o link da mídia é enviado como texto.
- `DEBUG=true` — logs detalhados.

---

## 9. Como funciona por dentro

- **Entrada (WhatsApp → Chatwoot):** o handler lê o payload `ReceivedCallback`, normaliza o
  telefone e, no Chatwoot, **encontra ou cria** o contato, garante um `contact_inbox`
  (com `source_id` = telefone) e **reaproveita a conversa aberta** ou cria uma nova. Depois
  grava a mensagem como `incoming`. O Chatwoot é a fonte da verdade; há um cache em memória
  só para reduzir chamadas, com refazimento automático em caso de `404`.
- **Saída (Chatwoot → WhatsApp):** o handler só age em `message_created` do tipo `outgoing`,
  não-privado e do inbox configurado (isso evita eco das mensagens que ele mesmo criou).
  O telefone destino vem de `conversation.meta.sender.phone_number` (ou do `source_id`).

---

## 10. Problemas comuns

- **Mensagem não entra no Chatwoot:** confira nos logs se o webhook chegou; valide
  `CHATWOOT_BASE_URL`, `ACCOUNT_ID`, `INBOX_ID` e o `ACCESS_TOKEN` (erros 401/404 aparecem no log).
- **Resposta não vai pro WhatsApp:** verifique se o evento `message_created` está marcado no
  Chatwoot e se o `ZAPI_CLIENT_TOKEN` está correto (403 "Token não informado" indica header
  `Client-Token` ausente/errado).
- **`401 unauthorized`:** o `WEBHOOK_TOKEN` da URL não bate com o do `.env`.
- **Z-API recusa o webhook:** a URL precisa ser **HTTPS** e pública.
- **Mensagens duplicadas em loop:** quase sempre é `FORWARD_FROM_ME=true` combinado com o
  reenvio do Chatwoot. Deixe em `false`.

---

> Observação: a Z-API utiliza uma sessão do WhatsApp Web e não é uma API oficial do WhatsApp.
> Respeite os termos de uso do WhatsApp e as boas práticas de envio para reduzir risco de bloqueio.
# whatschat
