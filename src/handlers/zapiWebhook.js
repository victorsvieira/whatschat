import { config } from '../config.js';
import { logger } from '../logger.js';
import * as chatwoot from '../chatwoot.js';
import * as zapi from '../zapi.js';

const MEDIA_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};

function extFromMime(mime, fallback = 'bin') {
  return MEDIA_EXT[mime] || fallback;
}

/**
 * Extrai o conteúdo relevante do payload "ReceivedCallback" da Z-API.
 * A Z-API entrega um objeto por tipo: text, image, audio, video, document, etc.
 */
function parseZapiMessage(payload) {
  const phoneDigits = chatwoot.onlyDigits(payload.phone);
  const name = payload.senderName || payload.chatName || phoneDigits;

  if (payload.text?.message !== undefined) {
    return { kind: 'text', phoneDigits, name, content: payload.text.message };
  }
  if (payload.image) {
    return {
      kind: 'image',
      phoneDigits,
      name,
      url: payload.image.imageUrl,
      mime: payload.image.mimeType,
      caption: payload.image.caption,
    };
  }
  if (payload.audio) {
    return {
      kind: 'audio',
      phoneDigits,
      name,
      url: payload.audio.audioUrl,
      mime: payload.audio.mimeType,
    };
  }
  if (payload.video) {
    return {
      kind: 'video',
      phoneDigits,
      name,
      url: payload.video.videoUrl,
      mime: payload.video.mimeType,
      caption: payload.video.caption,
    };
  }
  if (payload.document) {
    return {
      kind: 'document',
      phoneDigits,
      name,
      url: payload.document.documentUrl,
      mime: payload.document.mimeType,
      filename: payload.document.fileName || payload.document.title,
      caption: payload.document.caption,
    };
  }
  if (payload.location) {
    const { latitude, longitude, address } = payload.location;
    return {
      kind: 'text',
      phoneDigits,
      name,
      content: `📍 Localização: ${address || ''}\nhttps://maps.google.com/?q=${latitude},${longitude}`,
    };
  }
  if (payload.contact) {
    return {
      kind: 'text',
      phoneDigits,
      name,
      content: `👤 Contato: ${payload.contact.displayName || ''}\n${payload.contact.vcard || ''}`,
    };
  }
  // Tipo não tratado -> registra e ignora silenciosamente.
  return { kind: 'unsupported', phoneDigits, name, type: payload.type };
}

async function pushMedia(conversationId, msg) {
  if (!config.behavior.handleMedia || !msg.url) {
    // Sem tratamento de mídia: manda o link como texto.
    const label = msg.kind.toUpperCase();
    const text = [msg.caption, `[${label}] ${msg.url || '(sem url)'}`].filter(Boolean).join('\n');
    await chatwoot.createIncomingMessage(conversationId, text);
    return;
  }
  const { blob } = await zapi.downloadMedia(msg.url);
  const ext = extFromMime(msg.mime, msg.kind === 'document' ? 'pdf' : 'bin');
  const filename = msg.filename || `${msg.kind}-${Date.now()}.${ext}`;
  await chatwoot.createIncomingAttachment(conversationId, {
    file: blob,
    filename,
    caption: msg.caption,
  });
}

export async function handleZapiWebhook(payload) {
  // A Z-API usa esse webhook tanto para recebidas quanto (opcionalmente) enviadas por mim.
  if (payload.type && payload.type !== 'ReceivedCallback') {
    logger.debug('Ignorado: tipo de callback não tratado', payload.type);
    return { ignored: true, reason: 'type' };
  }
  if (payload.fromMe && !config.behavior.forwardFromMe) {
    logger.debug('Ignorado: mensagem fromMe', payload.phone);
    return { ignored: true, reason: 'fromMe' };
  }
  if (payload.isGroup && config.behavior.ignoreGroups) {
    logger.debug('Ignorado: mensagem de grupo', payload.phone);
    return { ignored: true, reason: 'group' };
  }
  if (!payload.phone) {
    return { ignored: true, reason: 'no-phone' };
  }

  const msg = parseZapiMessage(payload);
  if (msg.kind === 'unsupported') {
    logger.warn('Tipo de mensagem não suportado', msg.type);
    return { ignored: true, reason: 'unsupported', type: msg.type };
  }

  const { conversationId } = await chatwoot.resolveConversation({
    phoneDigits: msg.phoneDigits,
    name: msg.name,
  });

  try {
    if (msg.kind === 'text') {
      await chatwoot.createIncomingMessage(conversationId, msg.content);
    } else {
      await pushMedia(conversationId, msg);
    }
  } catch (err) {
    // Conversa pode ter sido resolvida/apagada -> limpa cache e tenta 1x de novo.
    if (err.status === 404) {
      chatwoot.invalidateCache(msg.phoneDigits);
      const retry = await chatwoot.resolveConversation({
        phoneDigits: msg.phoneDigits,
        name: msg.name,
      });
      if (msg.kind === 'text') {
        await chatwoot.createIncomingMessage(retry.conversationId, msg.content);
      } else {
        await pushMedia(retry.conversationId, msg);
      }
    } else {
      throw err;
    }
  }

  logger.info('WhatsApp -> Chatwoot', { phone: msg.phoneDigits, kind: msg.kind, conversationId });
  return { ok: true, conversationId, kind: msg.kind };
}

export default handleZapiWebhook;
