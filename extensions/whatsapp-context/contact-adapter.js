(function (root) {
  /* global URL, document */
  'use strict';

  function cleanText(value) {
    if (typeof value !== 'string') return '';
    let safe = '';
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code >= 0x20 && code !== 0x7f) safe += character;
    }
    return safe.replace(/\s+/g, ' ').trim();
  }

  function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    if (digits.length >= 12 && digits.length <= 15) return digits;
    return '';
  }

  function phoneFromHref(value) {
    const href = cleanText(value);
    if (!href) return '';
    try {
      const parsed = new URL(href, 'https://web.whatsapp.com');
      if (parsed.hostname === 'wa.me' || parsed.protocol === 'tel:') {
        return normalizePhone(parsed.pathname.replace(/^\//, '') || parsed.pathname);
      }
    } catch {
      // Continue with the conservative text fallback below.
    }
    return '';
  }

  function phoneFromText(value) {
    const matches = String(value || '').match(/(?:\+?55[\s.-]?)?(?:\(\d{2}\)|\d{2})[\s.-]?\d{4,5}[\s.-]?\d{4}/g) || [];
    for (const match of matches) {
      const normalized = normalizePhone(match);
      if (normalized) return normalized;
    }
    return '';
  }

  function unsupported() {
    return { status: 'unsupported', displayName: null, phone: null };
  }

  function extractContactSnapshot(input) {
    const source = input || {};
    if (source.group === true) return unsupported();

    const hrefs = Array.isArray(source.linkHrefs) ? source.linkHrefs : [];
    const hrefPhones = hrefs.map(phoneFromHref).filter(Boolean);
    const textPhone = phoneFromText(source.headerText);
    const phones = [...new Set([...hrefPhones, textPhone].filter(Boolean))];
    if (phones.length !== 1) return unsupported();
    const phone = phones[0];

    const titleTexts = Array.isArray(source.titleTexts) ? source.titleTexts : [];
    const candidates = [...titleTexts, ...String(source.headerText || '').split(/\n|·/)]
      .map(cleanText)
      .filter((value) => value && !normalizePhone(value));
    return {
      status: 'ready',
      displayName: candidates[0] || null,
      phone,
    };
  }

  function readActiveContact(documentValue) {
    const documentObject = documentValue || document;
    const header = documentObject.querySelector(
      '[data-testid="conversation-header"], [data-testid="conversation-info-header"], header'
    );
    if (!header) return unsupported();
    const titleTexts = Array.from(header.querySelectorAll('[title]'))
      .map((element) => element.getAttribute('title') || '');
    const linkHrefs = Array.from(header.querySelectorAll('a[href]'))
      .map((element) => element.getAttribute('href') || '');
    const testId = header.getAttribute('data-testid') || '';
    const group = /group|@g\.us/i.test(`${testId} ${linkHrefs.join(' ')}`);
    return extractContactSnapshot({
      headerText: header.innerText || header.textContent || '',
      titleTexts,
      linkHrefs,
      group,
    });
  }

  root.AspenWhatsAppContactAdapter = Object.freeze({
    normalizePhone,
    extractContactSnapshot,
    readActiveContact,
  });
})(globalThis);
