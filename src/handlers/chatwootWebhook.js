import { config } from '../config.js';
import { logger } from '../logger.js';
import * as chatwoot from '../chatwoot.js';
import * as zapi from '../zapi.js';

function isOutgoing(payload) {
  // Em webhooks o message_type costuma ser string; aceitamos número por segurança.
  return payload.message_type === 'outgoing' || payload.message_type === 1;
}

/** Descobre o telefone destino a partir do payload do webhook do Chatwoot. */
function extractPhone(payload) {
  const conv = payload.conversation || {};
  const candidates = [
    conv.meta?.sender?.phone_number,
    conv.contact_inbox?.source_id,
    payload.contact?.phone_number,
    payload.sender?.phone_number,
  ];
  for (const c of candidates) {
    const digits = chatwoot.onlyDigits(c);
    if (digits) return digits;
  }
  return null;
}

async function sendAttachment(phone, attachment, caption) {
  const url = attachment.data_url || attachment.file_url || attachment.thumb_url;
  if (!url) return;
  switch (attachment.file_type) {
    case 'image':
      await zapi.sendImage(phone, url, caption);
      break;
    case 'audio':
      await zapi.sendAudio(phone, url);
      break;
    case 'video':
      await zapi.sendVideo(phone, url, caption);
      break;
    default: {
      const filename = url.split('/').pop()?.split('?')[0] || 'arquivo';
      await zapi.sendDocument(phone, url, filename);
    }
  }
}

export async function handleChatwootWebhook(payload) {
  // Só nos interessa a criação de mensagens.
  if (payload.event && payload.event !== 'message_created') {
    return { ignored: true, reason: 'event', event: payload.event };
  }
  if (!isOutgoing(payload)) {
    return { ignored: true, reason: 'not-outgoing' };
  }
  if (payload.private === true) {
    return { ignored: true, reason: 'private-note' };
  }

  // Garante que a mensagem pertence ao inbox configurado.
  const inboxId = payload.conversation?.inbox_id ?? payload.inbox?.id;
  if (inboxId && inboxId !== config.chatwoot.inboxId) {
    return { ignored: true, reason: 'other-inbox', inboxId };
  }

  const phone = extractPhone(payload);
  if (!phone) {
    logger.warn('Webhook Chatwoot sem telefone identificável', { id: payload.id });
    return { ignored: true, reason: 'no-phone' };
  }

  const content = payload.content || '';
  const attachments = payload.attachments || [];

  // Texto (se houver). Para a 1ª mídia usamos o texto como legenda.
  if (content && (attachments.length === 0)) {
    await zapi.sendText(phone, content);
  }

  for (let i = 0; i < attachments.length; i += 1) {
    const caption = i === 0 ? content : undefined;
    await sendAttachment(phone, attachments[i], caption);
  }

  logger.info('Chatwoot -> WhatsApp', {
    phone,
    hasText: Boolean(content),
    attachments: attachments.length,
  });
  return { ok: true, phone };
}

export default handleChatwootWebhook;
