// SPDX-License-Identifier: GPL-3.0-or-later
// Presentation helpers and local message drafts; serial operations live in transport.js.
export function findContact(contacts, protocol, type, id) {
  return (contacts ?? []).find(contact => contact?.protocol === protocol && contact.type === type && contact.id === Number(id)) ??
    (contacts ?? []).find(contact => contact?.protocol === 'Both' && contact.type === type && contact.id === Number(id)) ?? null;
}

export function channelAddress(channel) {
  const individual = Boolean(channel.privateCall);
  return { protocol: channel.mode, type: individual ? 'unit' : 'group',
    id: channel.mode === 'P25' && !individual ? channel.talkgroup : channel.destinationId };
}

export const MESSAGE_DRAFT_LIMIT = 80;
export function validateMessageDraft(draft) {
  const errors = [];
  if (!draft || !['P25', 'DMR'].includes(draft.protocol)) errors.push('Choose P25 or DMR.');
  if (!draft || !['unit', 'group'].includes(draft.type)) errors.push('Choose an individual or group destination.');
  const maximum = draft?.protocol === 'P25' && draft?.type === 'group' ? 65535 : 16777215;
  if (!Number.isInteger(draft?.destinationId) || draft.destinationId < 1 || draft.destinationId > maximum)
    errors.push(`Destination must be a whole decimal ID from 1 to ${maximum}.`);
  if (typeof draft?.text !== 'string' || !draft.text.trim()) errors.push('Enter a message.');
  else if (draft.text.length > MESSAGE_DRAFT_LIMIT || /[^\x20-\x7E]/.test(draft.text))
    errors.push(`Use up to ${MESSAGE_DRAFT_LIMIT} printable ASCII characters on one line.`);
  return errors;
}

export function exportMessageDraft(draft, options) {
  const errors = validateMessageDraft(draft);
  if (errors.length) throw new Error(errors.join(' '));
  const extra = options === undefined ? {} : draftTextOptions(draft, options);
  return JSON.stringify({ format: 'dm32-message-draft', version: 1, protocol: draft.protocol,
    type: draft.type, destinationId: draft.destinationId, text: draft.text, ...extra }, null, 2) + '\n';
}

export function importMessageDraft(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('Message draft exceeds 4 KiB.');
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('Message draft must be valid JSON.'); }
  if (file?.format !== 'dm32-message-draft' || file.version !== 1) throw new Error('Unsupported message draft format.');
  const draft = { protocol: file.protocol, type: file.type, destinationId: file.destinationId, text: file.text };
  const errors = validateMessageDraft(draft);
  if (errors.length) throw new Error(errors.join(' '));
  if (Object.hasOwn(file, 'textFormat') || Object.hasOwn(file, 'acknowledgment')) Object.assign(draft, draftTextOptions(draft, { format: file.textFormat, acknowledgment: file.acknowledgment }));
  return draft;
}

function draftTextOptions(draft, { format, acknowledgment }) {
  if (![0, 1, 2].includes(format) || typeof acknowledgment !== 'boolean' || draft.protocol === 'P25' && format !== 0 || acknowledgment && (draft.protocol !== 'DMR' || draft.type !== 'unit' || format === 2)) throw new Error('Invalid draft text format or acknowledgment request.');
  return { textFormat: format, acknowledgment };
}

export const MESSAGE_FORMATS = Object.freeze({ 0: 'Motorola TMS', 1: 'ETSI text', 2: 'ETSI IP text' });
export const MESSAGE_STATES = Object.freeze({ DRAFT: 'Draft', QUEUED: 'Queued', SENDING: 'Sending',
  SENT: 'Sent · delivery unconfirmed', DELIVERED: 'Delivered', FAILED: 'Failed', RECEIVED: 'Received' });
export function messageReplyDraft(message) {
  if (!message || message.state !== 'RECEIVED' || !['P25', 'DMR'].includes(message.protocol) ||
      !Number.isInteger(message.sourceId) || message.sourceId < 1 || message.sourceId > 0xFFFFFF) throw new Error('This message has no valid individual reply address.');
  return { protocol: message.protocol, type: 'unit', destinationId: message.sourceId, text: '' };
}
