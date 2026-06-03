import express from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { handleZapiWebhook } from './handlers/zapiWebhook.js';
import { handleChatwootWebhook } from './handlers/chatwootWebhook.js';

const app = express();
app.use(express.json({ limit: '15mb' }));

// Verificação simples do segredo presente na URL dos webhooks.
function checkToken(req, res, next) {
  if (req.params.token !== config.webhookToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// WhatsApp (Z-API) -> Chatwoot
app.post('/webhooks/zapi/:token', checkToken, async (req, res) => {
  // Responde rápido; processa em segundo plano para não estourar timeout da Z-API.
  res.status(200).json({ received: true });
  try {
    await handleZapiWebhook(req.body || {});
  } catch (err) {
    logger.error('Erro ao processar webhook Z-API', {
      message: err.message,
      status: err.status,
      body: err.body,
    });
  }
});

// Chatwoot -> WhatsApp (Z-API)
app.post('/webhooks/chatwoot/:token', checkToken, async (req, res) => {
  res.status(200).json({ received: true });
  try {
    await handleChatwootWebhook(req.body || {});
  } catch (err) {
    logger.error('Erro ao processar webhook Chatwoot', {
      message: err.message,
      status: err.status,
      body: err.body,
    });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'not found' }));

app.listen(config.port, () => {
  logger.info(`Middleware Chatwoot <-> Z-API ouvindo na porta ${config.port}`);
  logger.info('Endpoints de webhook:');
  logger.info(`  Z-API     -> POST /webhooks/zapi/${config.webhookToken}`);
  logger.info(`  Chatwoot  -> POST /webhooks/chatwoot/${config.webhookToken}`);
});
