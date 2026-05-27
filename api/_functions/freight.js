// POST /api/freight — proxy para API de cotação de frete do Envia.com

import { createHttpError } from './lib/erpnext.js';

const ENVIA_TOKEN = process.env.ENVIA_TOKEN || '';
const ENVIA_BASE = process.env.ENVIA_BASE_URL || 'https://api.envia.com';

// ── Braspress ──
const BRASPRESS_USER = process.env.BRASPRESS_USER || '';
const BRASPRESS_PASSWORD = process.env.BRASPRESS_PASSWORD || '';
const BRASPRESS_BASE = 'https://api.braspress.com';
const BRASPRESS_AUTH = BRASPRESS_USER && BRASPRESS_PASSWORD
  ? 'Basic ' + Buffer.from(`${BRASPRESS_USER}:${BRASPRESS_PASSWORD}`).toString('base64')
  : '';
const BRASPRESS_MODALS = ['R', 'A']; // Rodoviário e Aéreo

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

// ── Braspress Quote ──
// Consulta Braspress para um determinado modal (R=rodoviário, A=aéreo).
// Retorna array de rates normalizados ou array vazio em caso de erro/indisponibilidade.
async function fetchBraspressRates(originCep, destinationCep, totalWeight, totalVolumes, cubagemArray, declaredValue, tipoFrete = '1') {
  if (!BRASPRESS_AUTH) return [];
  const sanitizeCnpj = (v) => String(v || '').replace(/\D/g, '');
  const cnpjRemetente = sanitizeCnpj(BRASPRESS_USER);
  if (!cnpjRemetente) return [];

  // Sem CNPJ/CPF do destinatário (cliente PF), a Braspress faz cotação só pelo CEP para CIF.
  const cnpjDest = sanitizeCnpj(destinationCep) || '00000000000';

  const rates = [];
  for (const modal of BRASPRESS_MODALS) {
    try {
      const body = {
        cnpjRemetente,
        cnpjDestinatario: cnpjDest,
        modal,
        tipoFrete,
        cepOrigem: sanitizeCnpj(originCep),
        cepDestino: sanitizeCnpj(destinationCep),
        vlrMercadoria: declaredValue || 100,
        peso: totalWeight,
        volumes: totalVolumes,
        cubagem: cubagemArray,
      };
      const res = await fetch(`${BRASPRESS_BASE}/v1/cotacao/calcular/json`, {
        method: 'POST',
        headers: { 'Authorization': BRASPRESS_AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(`[freight] braspress ${modal}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      if (data.statusCode && data.statusCode >= 400) {
        console.warn(`[freight] braspress ${modal}: ${data.message || 'erro'}`);
        continue;
      }
      if (!data.id && !data.totalFrete) continue;

      const modalLabel = modal === 'R' ? 'Rodoviário' : 'Aéreo';
      rates.push({
        carrier: 'braspress',
        service: modal === 'R' ? 'RODOVIARIO' : 'AEREO',
        serviceDescription: `Braspress ${modalLabel}`,
        deliveryEstimate: `${data.prazo || '?'} dias úteis`,
        deliveryDays: data.prazo ?? null,
        basePrice: normalizePrice(data.totalFrete),
        insurance: 0,
        additionalServices: [],
        additionalCharges: 0,
        taxes: 0,
        totalPrice: normalizePrice(data.totalFrete),
        currency: 'BRL',
        insuranceApplied: false,
      });
    } catch (err) {
      console.warn(`[freight] braspress ${modal} error:`, err.message);
    }
  }
  return rates;
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
    const insuranceRequested = insuranceValue > 0;
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

    console.info('[freight] quote', {
      carriers: carriers.length,
      insuranceValue,
      packages: packages.length,
      originCep,
      destinationCep,
    });

    // ── Braspress (paralelo) ──
    const totalWeight = envPackages.reduce((sum, p) => sum + p.weight * p.amount, 0);
    const totalVolumes = envPackages.reduce((sum, p) => sum + p.amount, 0);
    const cubagemArray = envPackages.map(p => ({
      altura: (p.dimensions.height / 100).toFixed(4),
      largura: (p.dimensions.width / 100).toFixed(4),
      comprimento: (p.dimensions.length / 100).toFixed(4),
      volumes: p.amount,
    }));
    const braspressPromise = fetchBraspressRates(originCep, destinationCep, totalWeight, totalVolumes, cubagemArray, insuranceValue || 100);
    // ── fim Braspress ──

    async function fetchCarrierRate(carrier, origin, destination, envPackages, additionalServices, insuranceRequested) {
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
        if (!res.ok) {
          console.warn(`[freight] ${carrier}: ${res.status}`);
          return [];
        }
        const data = await res.json();
        if (data.meta === 'error') {
          console.warn(`[freight] ${carrier}: ${data.error?.message || data.error || 'sem serviço disponível'}`);
          return [];
        }
        if (!data.data || !Array.isArray(data.data)) return [];

        console.info('[freight] carrier_result', { carrier, rates: data.data.length });
        const results = [];
        for (const r of data.data) {
          const insuranceCharge = normalizePrice(r.insurance);
          if (insuranceRequested && insuranceCharge <= 0) {
            console.info('[freight] filtered_no_insurance', {
              carrier: r.carrier || carrier,
              service: r.service || '',
              totalPrice: normalizePrice(r.totalPrice),
            });
            continue;
          }
          results.push({
            carrier: r.carrier || carrier,
            service: r.service || '',
            serviceDescription: r.serviceDescription || r.service || carrier,
            deliveryEstimate: r.deliveryEstimate || '',
            deliveryDays: r.deliveryDate?.dateDifference ?? null,
            basePrice: normalizePrice(r.basePrice),
            insurance: insuranceCharge,
            additionalServices: r.additionalServices || [],
            additionalCharges: normalizePrice(r.additionalCharges),
            taxes: normalizePrice(r.taxes),
            totalPrice: normalizePrice(r.totalPrice),
            currency: r.currency || 'BRL',
            insuranceApplied: insuranceRequested && insuranceCharge > 0,
          });
        }
        return results;
      } catch (err) {
        console.error(`[freight] ${carrier} error:`, err.message);
        return [];
      }
    }

    const carrierResults = await Promise.allSettled(
      carriers.map(carrier =>
        fetchCarrierRate(carrier, origin, destination, envPackages, additionalServices, insuranceRequested)
      )
    );

    const rates = [];
    let filteredCount = 0;
    for (const result of carrierResults) {
      if (result.status === 'fulfilled') {
        for (const r of result.value) {
          if (r.insuranceApplied === false && insuranceRequested) filteredCount++;
          rates.push(r);
        }
      }
    }

    // ── Merge Braspress ──
    try {
      const bpRates = await braspressPromise;
      if (bpRates.length) {
        console.info('[freight] braspress_result', { rates: bpRates.length });
        rates.push(...bpRates);
      }
    } catch (err) {
      console.warn('[freight] braspress error:', err.message);
    }

    rates.sort((a, b) => a.totalPrice - b.totalPrice);

    console.info('[freight] result', {
      totalRates: rates.length,
      filteredNoInsurance: filteredCount,
      insuranceRequested,
    });

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
