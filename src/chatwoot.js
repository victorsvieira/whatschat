import { config } from './config.js';
import { logger } from './logger.js';

const { baseUrl, accountId, apiAccessToken, inboxId } = config.chatwoot;
const API = `${baseUrl}/api/v1/accounts/${accountId}`;

const jsonHeaders = {
  'Content-Type': 'application/json',
  api_access_token: apiAccessToken,
};

async function cwFetch(path, options = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      api_access_token: apiAccessToken,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Chatwoot ${options.method || 'GET'} ${path} -> ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Mantém apenas dígitos do telefone. Ex: "+55 (44) 99999-9999" -> "5544999999999" */
export function onlyDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** Procura um contato existente pelo telefone (busca textual do Chatwoot). */
async function findContactByPhone(phoneDigits) {
  const body = await cwFetch(`/contacts/search?q=${encodeURIComponent(phoneDigits)}`);
  const payload = body.payload || [];
  return (
    payload.find(
      (c) =>
        onlyDigits(c.phone_number) === phoneDigits ||
        onlyDigits(c.identifier) === phoneDigits,
    ) || null
  );
}

/** Cria um novo contato vinculado ao inbox API. */
async function createContact({ phoneDigits, name }) {
  const body = await cwFetch('/contacts', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      inbox_id: inboxId,
      name: name || phoneDigits,
      phone_number: `+${phoneDigits}`,
      identifier: phoneDigits,
    }),
  });
  // Resposta: { payload: { contact: {...}, contact_inbox: { source_id, inbox } } }
  const contact = body.payload?.contact || body.payload;
  const contactInbox = body.payload?.contact_inbox;
  return { contact, sourceId: contactInbox?.source_id };
}

/** Garante que exista um contact_inbox para o contato neste inbox e retorna o source_id. */
async function ensureContactInbox(contactId, phoneDigits, existingContact) {
  // 1) Já veio na busca?
  const fromContact = (existingContact?.contact_inboxes || []).find(
    (ci) => ci.inbox?.id === inboxId,
  );
  if (fromContact?.source_id) return fromContact.source_id;

  // 2) Tenta criar com source_id = telefone (determinístico).
  try {
    const body = await cwFetch(`/contacts/${contactId}/contact_inboxes`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ inbox_id: inboxId, source_id: phoneDigits }),
    });
    return body.source_id || phoneDigits;
  } catch (err) {
    // 422 normalmente significa que o source_id já existe -> reusa o telefone.
    if (err.status === 422) return phoneDigits;
    throw err;
  }
}

/** Busca uma conversa aberta (não resolvida) do contato neste inbox. */
async function findOpenConversation(contactId) {
  const body = await cwFetch(`/contacts/${contactId}/conversations`);
  const list = body.payload || [];
  const candidates = list
    .filter((c) => c.inbox_id === inboxId && c.status !== 'resolved')
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return candidates[0] || null;
}

/** Cria uma nova conversa no inbox API. */
async function createConversation({ sourceId, contactId }) {
  const body = await cwFetch('/conversations', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      source_id: sourceId,
      inbox_id: inboxId,
      contact_id: contactId,
      status: 'open',
    }),
  });
  return body;
}

// Cache simples em memória: phone -> { contactId, sourceId, conversationId }
const cache = new Map();

/**
 * Resolve (ou cria) contato + conversa aberta para um telefone.
 * Chatwoot é a fonte da verdade; o cache só reduz chamadas.
 */
export async function resolveConversation({ phoneDigits, name }) {
  const cached = cache.get(phoneDigits);
  if (cached) return cached;

  let contact = await findContactByPhone(phoneDigits);
  let sourceId;

  if (!contact) {
    const created = await createContact({ phoneDigits, name });
    contact = created.contact;
    sourceId = created.sourceId || (await ensureContactInbox(contact.id, phoneDigits, contact));
  } else {
    sourceId = await ensureContactInbox(contact.id, phoneDigits, contact);
  }

  let conversation = await findOpenConversation(contact.id);
  if (!conversation) {
    conversation = await createConversation({ sourceId, contactId: contact.id });
  }

  const result = {
    contactId: contact.id,
    sourceId,
    conversationId: conversation.id,
  };
  cache.set(phoneDigits, result);
  return result;
}

/** Invalida o cache de um telefone (ex.: conversa foi resolvida e some o 404). */
export function invalidateCache(phoneDigits) {
  cache.delete(phoneDigits);
}

/** Cria uma mensagem de entrada (do contato) na conversa. */
export async function createIncomingMessage(conversationId, content) {
  return cwFetch(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      content: content || '',
      message_type: 'incoming',
    }),
  });
}

/**
 * Cria uma mensagem de entrada com anexo (mídia), via multipart.
 * `file` é um Blob; `filename` o nome do arquivo.
 */
export async function createIncomingAttachment(conversationId, { file, filename, caption }) {
  const form = new FormData();
  form.append('message_type', 'incoming');
  if (caption) form.append('content', caption);
  form.append('attachments[]', file, filename);

  const res = await fetch(`${API}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { api_access_token: apiAccessToken }, // sem Content-Type: o fetch define o boundary
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Chatwoot upload anexo -> ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

export default {
  onlyDigits,
  resolveConversation,
  invalidateCache,
  createIncomingMessage,
  createIncomingAttachment,
};
