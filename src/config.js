import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`[config] Variável de ambiente obrigatória ausente: ${name}`);
    process.exit(1);
  }
  return value.trim();
}

function optional(name, fallback = '') {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

export const config = {
  // Servidor
  port: parseInt(optional('PORT', '3333'), 10),
  webhookToken: required('WEBHOOK_TOKEN'), // segredo compartilhado na URL dos webhooks

  // Chatwoot
  chatwoot: {
    baseUrl: required('CHATWOOT_BASE_URL').replace(/\/+$/, ''), // ex: https://chat.seudominio.com
    accountId: required('CHATWOOT_ACCOUNT_ID'),
    apiAccessToken: required('CHATWOOT_API_ACCESS_TOKEN'), // Profile Settings -> Access Token
    inboxId: parseInt(required('CHATWOOT_INBOX_ID'), 10), // ID da caixa de entrada do tipo "API"
  },

  // Z-API
  zapi: {
    instanceId: required('ZAPI_INSTANCE_ID'),
    instanceToken: required('ZAPI_INSTANCE_TOKEN'),
    clientToken: required('ZAPI_CLIENT_TOKEN'), // "Account Security Token" (header Client-Token)
    baseUrl: optional('ZAPI_BASE_URL', 'https://api.z-api.io'),
  },

  // Comportamento
  behavior: {
    // Encaminhar mensagens enviadas pelo próprio número (fromMe). Padrão false p/ evitar loop.
    forwardFromMe: optional('FORWARD_FROM_ME', 'false') === 'true',
    // Ignorar mensagens de grupos.
    ignoreGroups: optional('IGNORE_GROUPS', 'true') === 'true',
    // Baixar e reenviar mídias (imagem/áudio/vídeo/documento). Se false, envia apenas um link.
    handleMedia: optional('HANDLE_MEDIA', 'true') === 'true',
  },
};

export default config;
