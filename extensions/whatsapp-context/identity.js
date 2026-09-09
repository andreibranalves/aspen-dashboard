/* Runs in WhatsApp's MAIN world. Reads identity only; no messages or network calls. */
(function installIdentityBridge(global) {
  'use strict';
  function serialized(value) {
    const raw = typeof value === 'string' ? value : value && value._serialized;
    return typeof raw === 'string' && /^\d{5,20}(?::\d+)?@(c\.us|s\.whatsapp\.net|lid|g\.us)$/.test(raw) ? raw : '';
  }
  global.addEventListener('message', function (event) {
    const request = event.data;
    if (event.source !== global || event.origin !== 'https://web.whatsapp.com' || !request || request.type !== 'aspen:identity-request' || typeof request.requestId !== 'string' || request.requestId.length > 80) return;
    let identity = { status: 'unavailable' };
    try {
      const chat = global.require('WAWebCollections').Chat.getActive();
      const accountId = serialized(global.require('WAWebUserPrefsMeUser').getMaybeMePnUser());
      const technicalId = serialized(chat && chat.id);
      let phoneId = technicalId;
      if (technicalId.endsWith('@lid')) {
        try { phoneId = serialized(global.require('WAWebApiContact').getPhoneNumber(chat.id)); }
        catch { phoneId = ''; }
      }
      identity = { status: chat ? 'resolved' : 'idle', accountId, technicalId, phone: /@(c\.us|s\.whatsapp\.net)$/.test(phoneId) ? phoneId.split('@')[0].split(':')[0] : '' };
    } catch { /* Missing modules stay unavailable; no arbitrary store scans. */ }
    global.postMessage({ type: 'aspen:identity-response', requestId: request.requestId, identity }, 'https://web.whatsapp.com');
  });
})(globalThis);
