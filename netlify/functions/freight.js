// POST /api/freight — proxy para API de cotação de frete do Envia.com

import { createHttpError } from './lib/erpnext.js';

const ENVIA_TOKEN = process.env.ENVIA_TOKEN || '';
const ENVIA_BASE = process.env.ENVIA_BASE_URL || 'https://api.envia.com';

const ASPEN_ORIGIN = {
  name: 'Aspen Estamparia',
  street: process.env.ASPEN_STREET || 'Rua Exemplo, 123',
  city: process.env.ASPEN_CITY || 'São Paulo',
  state: process.env.ASPEN_STATE || 'SP',
  country: 'BR',
  postalCode: process.env.ASPEN_CEP || '01001000',
  phone: process.env.ASPEN_PHONE || '(11) 99999-9999',
};

const BR_CARRIERS = ['correios', 'jadlog', 'loggi', 'totalexpress'];

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  let payload;
  try { payload = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }
  try {
    const dest = payload.destination || {};
    if (!dest.cep) throw createHttpError(400, 'Informe o CEP de destino.');
    const packages = payload.packages || [];
    if (!Array.isArray(packages) || packages.length === 0) throw createHttpError(400, 'Informe pelo menos um pacote.');
    for (let i = 0; i < packages.length; i++) {
      if (!packages[i].weight || packages[i].weight <= 0) throw createHttpError(400, `Pacote ${i + 1}: informe o peso (kg).`);
    }
    const requestedCarrier = payload.carrier || null;
    const carriers = requestedCarrier ? [requestedCarrier] : BR_CARRIERS;
    const envPackages = packages.map(pkg => ({
      type: 'box', content: pkg.content || 'Produtos personalizados', amount: pkg.amount || 1,
      declaredValue: pkg.declaredValue || 100, lengthUnit: 'CM', weightUnit: 'KG', weight: pkg.weight,
      dimensions: { length: pkg.length || 30, width: pkg.width || 20, height: pkg.height || 10 },
    }));
    const destination = {
      name: dest.name || 'Cliente', street: dest.street || `${dest.cep}`, city: dest.city || '',
      state: dest.state || '', country: 'BR', postalCode: dest.cep.replace(/\D/g, ''),
    };
    const rates = [];
    for (const carrier of carriers) {
      try {
        const res = await fetch(`${ENVIA_BASE}/ship/rate/`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${ENVIA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin: ASPEN_ORIGIN, destination, packages: envPackages, shipment: { type: 1, carrier } }),
        });
        if (!res.ok) { console.warn(`[freight] ${carrier}: ${res.status}`); continue; }
        const data = await res.json();
        if (data.data && Array.isArray(data.data)) {
          for (const r of data.data) {
            rates.push({ carrier: r.carrier || carrier, service: r.service || '', serviceDescription: r.serviceDescription || r.service || carrier,
              deliveryEstimate: r.deliveryEstimate || '', deliveryDays: r.deliveryDate?.dateDifference || null,
              totalPrice: parseFloat(r.totalPrice) || 0, currency: r.currency || 'BRL' });
          }
        }
      } catch (err) { console.error(`[freight] ${carrier} error:`, err.message); }
    }
    rates.sort((a, b) => a.totalPrice - b.totalPrice);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      success: true, rates, origin: { city: ASPEN_ORIGIN.city, state: ASPEN_ORIGIN.state, cep: ASPEN_ORIGIN.postalCode },
      destination: { cep: dest.cep.replace(/\D/g, ''), city: dest.city || destination.city, state: dest.state || destination.state },
    })};
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[freight]', err?.logMessage || err?.message || err);
    return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err?.message || 'Erro ao cotar frete.' }) };
  }
}
