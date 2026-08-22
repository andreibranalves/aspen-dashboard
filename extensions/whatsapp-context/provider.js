/* global setTimeout, clearTimeout */
/* WhatsApp-specific DOM/IndexedDB adapter. The panel never imports this module's details. */
(function installAspenWhatsappProvider(global) {
  'use strict';

  const MAX_DATABASES = 4;
  const MAX_STORES = 8;
  const MAX_KEYS_PER_STORE = 50;
  const MAX_MESSAGE_NODES = 40;
  const RESOLUTION_TIMEOUT_MS = 1500;
  const CACHE_TTL_MS = 3000;
  const PHONE_RE = /(?:^|[^\d])((?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[\s-]?\d{4})(?:[^\d]|$)/;
  const JID_RE = /^(\d{10,15})@(s\.whatsapp\.net|c\.us)$/i;

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizePhone(value) {
    const raw = clean(value);
    if (!raw || raw.includes('@') && !JID_RE.test(raw)) return '';
    let digits = raw.split('@')[0].replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return /^\d{10,15}$/.test(digits) ? digits : '';
  }

  function phoneFromText(value) {
    const match = clean(value).match(PHONE_RE);
    return match ? normalizePhone(match[1]) : '';
  }

  function textFromElement(element) {
    if (!element) return '';
    return clean(element.getAttribute('title') || element.textContent || '');
  }

  function selectedHeader(documentRef) {
    const selectors = [
      '[data-testid="conversation-info-header-chat-title"]',
      '[data-testid="conversation-header"]',
      '[role="main"] header',
    ];
    for (const selector of selectors) {
      const element = documentRef.querySelector(selector);
      if (element && textFromElement(element)) return element;
    }
    return null;
  }

  function technicalId(documentRef, header) {
    const candidates = [header, documentRef.querySelector('[role="main"]'), documentRef.body];
    if (header && header.querySelectorAll) {
      try { candidates.push(...Array.from(header.querySelectorAll('[data-id], [data-message-id]')).slice(0, 4)); }
      catch { /* markup may change while WhatsApp rerenders */ }
    }
    for (const element of candidates) {
      if (!element) continue;
      for (const attribute of ['data-id', 'data-message-id', 'data-testid', 'aria-label', 'title']) {
        const value = clean(element.getAttribute && element.getAttribute(attribute));
        if (/@(?:lid|g\.us|broadcast|s\.whatsapp\.net|c\.us)/i.test(value)) return value;
      }
    }
    return '';
  }

  function displayName(header) {
    if (!header) return '';
    const labelled = header.querySelector('[title], [aria-label]');
    return clean(labelled && (labelled.getAttribute('title') || labelled.getAttribute('aria-label'))) || textFromElement(header);
  }

  function isGroup(id, headerText) {
    return /@(g\.us|broadcast)$/i.test(id) || /\b(grupo|group|comunidade|community)\b/i.test(headerText);
  }

  function keyText(key) {
    if (typeof key === 'string') return key;
    if (typeof key === 'number') return String(key);
    if (!key || typeof key !== 'object') return '';
    try {
      return JSON.stringify(key, function (_name, value) {
        if (typeof value === 'string' && value.length > 120) return value.slice(0, 120);
        return value;
      });
    } catch {
      return '';
    }
  }

  function phoneFromKey(key) {
    const value = keyText(key);
    const jid = value.match(/(\d{10,15})@(s\.whatsapp\.net|c\.us)/i);
    return normalizePhone(jid ? jid[1] : phoneFromText(value));
  }

  const resolutionCache = new Map();

  function phoneFromMessageDom(documentRef, id) {
    if (!id || !documentRef || !documentRef.querySelectorAll) return '';
    const selectors = '[data-id], [data-message-id], [data-from], [data-to], [data-pre-plain-text]';
    let elements;
    try { elements = Array.from(documentRef.querySelectorAll(selectors)).slice(0, MAX_MESSAGE_NODES); }
    catch { return ''; }
    for (const element of elements) {
      const values = ['data-id', 'data-message-id', 'data-from', 'data-to', 'data-phone', 'data-pre-plain-text', 'aria-label', 'title']
        .map(function (attribute) { return element.getAttribute && element.getAttribute(attribute); })
        .filter(Boolean);
      const serialized = values.map(keyText).join(' ');
      if (!serialized.includes(id)) continue;
      for (const value of values) {
        const phone = phoneFromKey(value);
        if (phone) return phone;
      }
    }
    return '';
  }

  function withTimeout(promise, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { reject(new Error('identity lookup timeout')); }, timeoutMs);
      promise.then(function (value) {
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async function readModelStoragePhone(id, indexedDbRef) {
    if (!id || !indexedDbRef || typeof indexedDbRef.databases !== 'function') return '';
    const databases = await withTimeout(indexedDbRef.databases(), RESOLUTION_TIMEOUT_MS);
    const candidates = (Array.isArray(databases) ? databases : [])
      .filter(function (item) { return /model-storage|whatsapp/i.test(String(item && item.name || '')); })
      .slice(0, MAX_DATABASES);
    for (const databaseInfo of candidates) {
      const database = await withTimeout(new Promise(function (resolve, reject) {
        const request = indexedDbRef.open(databaseInfo.name, databaseInfo.version);
        request.onerror = function () { reject(request.error || new Error('indexedDB open failed')); };
        request.onsuccess = function () { resolve(request.result); };
      }), RESOLUTION_TIMEOUT_MS);
      try {
        const stores = Array.from(database.objectStoreNames || []).slice(0, MAX_STORES);
        for (const storeName of stores) {
          const keys = await withTimeout(new Promise(function (resolve, reject) {
            const transaction = database.transaction(storeName, 'readonly');
            const request = transaction.objectStore(storeName).getAllKeys(MAX_KEYS_PER_STORE);
            request.onerror = function () { reject(request.error || new Error('indexedDB read failed')); };
            request.onsuccess = function () { resolve(request.result || []); };
          }), RESOLUTION_TIMEOUT_MS);
          for (const key of Array.isArray(keys) ? keys : []) {
            const phone = phoneFromKey(key);
            if (phone && keyText(key).includes(id)) return phone;
          }
          const records = await withTimeout(new Promise(function (resolve, reject) {
            const transaction = database.transaction(storeName, 'readonly');
            const request = transaction.objectStore(storeName).getAll(null, MAX_KEYS_PER_STORE);
            request.onerror = function () { reject(request.error || new Error('indexedDB read failed')); };
            request.onsuccess = function () { resolve(request.result || []); };
          }), RESOLUTION_TIMEOUT_MS);
          for (const record of Array.isArray(records) ? records : []) {
            if (keyText(record).indexOf(id) === -1) continue;
            const fields = ['remoteJid', 'senderPn', 'participant', 'from', 'to', 'id', 'key', 'chatId'];
            for (const field of fields) {
              const phone = phoneFromKey(record && typeof record === 'object' ? record[field] : record);
              if (phone) return phone;
            }
          }
        }
      } finally {
        if (typeof database.close === 'function') database.close();
      }
    }
    return '';
  }

  async function resolveConversation(options) {
    const opts = options || {};
    const documentRef = opts.documentRef || global.document;
    const indexedDbRef = opts.indexedDBRef || global.indexedDB;
    if (!documentRef || !documentRef.querySelector) return { status: 'unsupported' };

    const header = selectedHeader(documentRef);
    const technical = technicalId(documentRef, header);
    const headerText = textFromElement(header);
    if (!header && !technical) return { status: 'idle' };
    const cacheKey = technical || `header:${headerText}`;
    const cached = !opts.force ? resolutionCache.get(cacheKey) : null;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
    const remember = function (value) {
      resolutionCache.set(cacheKey, { at: Date.now(), value });
      if (resolutionCache.size > 20) resolutionCache.delete(resolutionCache.keys().next().value);
      return value;
    };
    if (isGroup(technical, headerText)) {
      return remember({ status: 'unsupported', technicalId: technical || null, displayName: displayName(header) || null });
    }

    const visiblePhone = normalizePhone(headerText) || phoneFromText(headerText);
    if (visiblePhone) {
      return remember({
        status: 'ready',
        displayName: displayName(header) || null,
        phone: visiblePhone,
        technicalId: technical || null,
        source: 'visible-phone',
      });
    }
    const messagePhone = phoneFromMessageDom(documentRef, technical);
    if (messagePhone) {
      return remember({
        status: 'ready',
        displayName: displayName(header) || null,
        phone: messagePhone,
        technicalId: technical || null,
        source: 'message-store',
      });
    }

    try {
      const storedPhone = await readModelStoragePhone(technical, indexedDbRef);
      if (storedPhone) {
        return remember({
          status: 'ready',
          displayName: displayName(header) || null,
          phone: storedPhone,
          technicalId: technical || null,
          source: 'model-storage',
        });
      }
    } catch (error) {
      return remember({
        status: 'unresolved',
        displayName: displayName(header) || null,
        technicalId: technical || null,
        reason: error && error.message === 'identity lookup timeout' ? 'timeout' : 'storage-unavailable',
      });
    }
    return remember({
      status: 'unresolved',
      displayName: displayName(header) || null,
      technicalId: technical || null,
      reason: technical && /@lid/i.test(technical) ? 'lid-only' : 'phone-not-visible',
    });
  }

  global.AspenWhatsappProvider = Object.freeze({
    clean,
    normalizePhone,
    phoneFromKey,
    resolveConversation,
    constants: Object.freeze({ MAX_DATABASES, MAX_STORES, MAX_KEYS_PER_STORE, MAX_MESSAGE_NODES, RESOLUTION_TIMEOUT_MS, CACHE_TTL_MS }),
  });
})(globalThis);
