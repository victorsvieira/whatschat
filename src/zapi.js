import { config } from './config.js';

const { instanceId, instanceToken, clientToken, baseUrl } = config.zapi;
const INSTANCE_URL = `${baseUrl}/instances/${instanceId}/token/${instanceToken}`;

const headers = {
  'Content-Type': 'application/json',
  'Client-Token': clientToken,
};

async function post(endpoint, payload) {
  const res = await fetch(`${INSTANCE_URL}/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Z-API POST ${endpoint} -> ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function sendText(phone, message) {
  return post('send-text', { phone, message });
}

export function sendImage(phone, image, caption) {
  // `image` pode ser uma URL pública ou base64 (data:image/...;base64,...)
  return post('send-image', { phone, image, caption });
}

export function sendAudio(phone, audio) {
  return post('send-audio', { phone, audio });
}

export function sendVideo(phone, video, caption) {
  return post('send-video', { phone, video, caption });
}

export function sendDocument(phone, documentUrl, fileName, extension) {
  const ext = (extension || fileName?.split('.').pop() || 'pdf').toLowerCase();
  return post(`send-document/${ext}`, { phone, document: documentUrl, fileName });
}

/** Baixa uma mídia (URL da Z-API) e devolve { blob, contentType }. */
export async function downloadMedia(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar mídia Z-API -> ${res.status}`);
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await res.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: contentType });
  return { blob, contentType };
}

export default {
  sendText,
  sendImage,
  sendAudio,
  sendVideo,
  sendDocument,
  downloadMedia,
};
