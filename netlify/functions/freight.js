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

// Transportadoras domésticas listadas pela própria Envia.com para Brasil.
// A disponibilidade real varia por trecho; serviços sem retorno são ignorados.
const BR_CARRIERS = [
  'correios',
  'jadlog',
  'loggi',
  'totalexpress',
  'buslog',
  'jtexpress',
  'dhl',
  'fedex',
  'ups',
  'shippify',
];

const CEP_STATE_BY_PREFIX = {
  '01': 'SP', '02': 'SP', '03': 'SP', '04': 'SP', '05': 'SP', '06': 'SP', '07': 'SP', '08': 'SP', '09': 'SP',
  '20': 'RJ', '21': 'RJ', '22': 'RJ', '23': 'RJ', '24': 'RJ', '25': 'RJ', '26': 'RJ', '27': 'RJ', '28': 'RJ',
  '30': 'MG', '31': 'MG', '32': 'MG', '33': 'MG', '34': 'MG', '35': 'MG', '36': 'MG', '37': 'MG', '38': 'MG', '39': 'MG',
  '40': 'BA', '41': 'BA', '42': 'BA', '43': 'BA', '44': 'BA', '45': 'BA', '46': 'BA', '47': 'BA', '48': 'BA',
  '50': 'PE', '51': 'PE', '52': 'PE', '53': 'PE', '54': 'PE', '55': 'PE', '56': 'PE',
  '60': 'CE', '61': 'CE', '62': 'CE', '63': 'CE',
  '70': 'DF', '71': 'DF', '72': 'DF', '73': 'DF',
  '80': 'PR', '81': 'PR', '82': 'PR', '83': 'PR', '84': 'PR', '85': 'PR', '86': 'PR', '87': 'PR',
  '90': 'RS', '91': 'RS', '92': 'RS', '93': 'RS', '94': 'RS', '95': 'RS', '96': 'RS', '97': 'RS', '98': 'RS', '99': 'RS',
};

function cleanCep(value = '') {
  return String(value).replace(/\D/g, '');
}

function inferStateFromCep(cep, fallback = 'SP') {
  return CEP_STATE_BY_PREFIX[cleanCep(cep).substring(0, 2)] || fallback;
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  let payload;
  try { payload = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }
  try {
    if (!ENVIA_TOKEN) throw createHttpError(500, 'Token da Envia.com não configurado.');

    const dest = payload.destination || {};
    const orig = payload.origin || {};
    if (!orig.cep) throw createHttpError(400, 'Informe o CEP de origem.');
    if (!dest.cep) throw createHttpError(400, 'Informe o CEP de destino.');

    const packages = payload.packages || [];
    if (!Array.isArray(packages) || packages.length === 0) throw createHttpError(400, 'Informe pelo menos um pacote.');
    for (let i = 0; i < packages.length; i++) {
      if (!packages[i].weight || packages[i].weight <= 0) throw createHttpError(400, `Pacote ${i + 1}: informe o peso (kg).`);
    }

    // Sempre consulta todas as transportadoras brasileiras oferecidas pela Envia.
    // O campo payload.carrier é mantido ignorado de propósito para evitar filtro manual no frontend.
    const carriers = BR_CARRIERS;
    const insuranceValue = positiveNumber(payload.insuranceValue ?? payload.insurance, 0);
    const packageUnitCount = packages.reduce((sum, pkg) => sum + positiveNumber(pkg.amount, 1), 0) || packages.length;
    const declaredValuePerUnit = insuranceValue > 0 ? Number((insuranceValue / packageUnitCount).toFixed(2)) : 100;

    const envPackages = packages.map(pkg => ({
      type: 'box',
      content: pkg.content || 'Produtos personalizados',
      amount: positiveNumber(pkg.amount, 1),
      declaredValue: positiveNumber(pkg.declaredValue, declaredValuePerUnit),
      lengthUnit: 'CM',
      weightUnit: 'KG',
      weight: positiveNumber(pkg.weight),
      dimensions: {
        length: positiveNumber(pkg.length, 30),
        width: positiveNumber(pkg.width, 20),
        height: positiveNumber(pkg.height, 10),
      },
    }));

    const originCep = cleanCep(orig.cep);
    const destinationCep = cleanCep(dest.cep);
    const origin = {
      ...ASPEN_ORIGIN,
      street: orig.street || ASPEN_ORIGIN.street,
      city: orig.city || ASPEN_ORIGIN.city,
      state: orig.state || ASPEN_ORIGIN.state || inferStateFromCep(originCep, 'RJ'),
      postalCode: originCep,
    };
    const destination = {
      name: dest.name || 'Cliente',
      street: dest.street || `${dest.cep}`,
      city: dest.city || '',
      state: dest.state || inferStateFromCep(destinationCep, 'SP'),
      country: 'BR',
      postalCode: destinationCep,
    };
    if (!origin.state || origin.state.length < 2) origin.state = inferStateFromCep(originCep, 'RJ');
    if (!destination.state || destination.state.length < 2) destination.state = inferStateFromCep(destinationCep, 'SP');

    const additionalServices = insuranceValue > 0
      ? [{ service: 'envia_insurance', data: { amount: String(insuranceValue) } }]
      : undefined;

    const rates = [];
    for (const carrier of carriers) {
      try {
        const requestBody = {
          origin,
          destination,
          packages: envPackages,
          shipment: { type: 1, carrier },
          ...(additionalServices ? { additionalServices } : {}),
        };
        const res = await fetch(`${ENVIA_BASE}/ship/rate/`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${ENVIA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        if (!res.ok) { console.warn(`[freight] ${carrier}: ${res.status}`); continue; }
        const data = await res.json();
        if (data.meta === 'error') {
          console.warn(`[freight] ${carrier}: ${data.error?.message || data.error || 'sem serviço disponível'}`);
          continue;
        }
        if (data.data && Array.isArray(data.data)) {
          for (const r of data.data) {
            rates.push({
              carrier: r.carrier || carrier,
              service: r.service || '',
              serviceDescription: r.serviceDescription || r.service || carrier,
              deliveryEstimate: r.deliveryEstimate || '',
              deliveryDays: r.deliveryDate?.dateDifference ?? null,
              totalPrice: normalizePrice(r.totalPrice),
              currency: r.currency || 'BRL',
              insurance: normalizePrice(r.insurance),
              additionalCharges: normalizePrice(r.additionalCharges),
            });
          }
        }
      } catch (err) { console.error(`[freight] ${carrier} error:`, err.message); }
    }

    rates.sort((a, b) => a.totalPrice - b.totalPrice);

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      success: true,
      rates,
      carriersConsulted: carriers,
      insuranceValue,
      origin: { cep: originCep, city: origin.city, state: origin.state, street: origin.street },
      destination: { cep: destinationCep, city: dest.city || destination.city, state: dest.state || destination.state, street: destination.street },
    })};
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[freight]', err?.logMessage || err?.message || err);
    return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err?.message || 'Erro ao cotar frete.' }) };
  }
}
