import { useState, useCallback } from 'react';
import { Truck, Search, Plus, X, ArrowLeft, RefreshCw, Package, ShieldCheck, MapPin, Info } from 'lucide-react';
import { apiPost } from '@/lib/api.js';
import { formatBRL } from '@/lib/formatters.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import SkeletonTable from '@/components/SkeletonTable.jsx';

const CARRIER_BRANDS = {
  correios: { label: 'Correios', logo: '/logos/carriers/correios.svg' },
  jadlog: { label: 'Jadlog', logo: '/logos/carriers/jadlog.svg' },
  loggi: { label: 'Loggi', logo: '/logos/carriers/loggi.svg' },
  totalexpress: { label: 'Total Express', logo: '/logos/carriers/totalexpress.svg' },
  buslog: { label: 'Buslog', logo: '/logos/carriers/buslog.svg' },
  jtexpress: { label: 'J&T Express', logo: '/logos/carriers/jtexpress.svg' },
  dhl: { label: 'DHL Express', logo: '/logos/carriers/dhl.svg' },
  fedex: { label: 'FedEx', logo: '/logos/carriers/fedex.svg' },
  ups: { label: 'UPS', logo: '/logos/carriers/ups.svg' },
  shippify: { label: 'Shippify', logo: '/logos/carriers/shippify.svg' },
};

// ── ViaCEP ──
async function lookupCep(cep) {
  const clean = cep.replace(/\D/g, '');
  if (clean.length !== 8) throw new Error('CEP deve ter 8 dígitos.');
  const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
  const data = await res.json();
  if (data.erro) throw new Error('CEP não encontrado.');
  return {
    cep: clean,
    city: data.localidade || '',
    state: data.uf || '',
    neighborhood: data.bairro || '',
    street: data.logradouro || '',
    display: `${data.localidade} / ${data.uf}${data.bairro ? ' — ' + data.bairro : ''}`,
    raw: data,
  };
}

function carrierKey(carrier = '') {
  return String(carrier).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function carrierBrand(carrier = '') {
  const key = carrierKey(carrier);
  if (key.includes('total')) return CARRIER_BRANDS.totalexpress;
  if (key.includes('jadlog')) return CARRIER_BRANDS.jadlog;
  if (key.includes('jtexpress') || key === 'jt') return CARRIER_BRANDS.jtexpress;
  return CARRIER_BRANDS[key] || { label: carrier || 'Transportadora', logo: null };
}

function cleanServiceName(rate) {
  const brand = carrierBrand(rate.carrier).label;
  const raw = rate.serviceDescription || rate.service || 'Serviço';
  return raw.replace(new RegExp(`^${brand}\\s+`, 'i'), '').trim() || raw;
}

function formatCep(cep = '') {
  const clean = cep.replace(/\D/g, '');
  return clean.length === 8 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : cep;
}

function formatPrazo(rate) {
  if (rate.deliveryDays != null && Number.isFinite(Number(rate.deliveryDays))) {
    const days = Number(rate.deliveryDays);
    return `${days} dia${days === 1 ? '' : 's'} útil${days === 1 ? '' : 'eis'}`;
  }
  return rate.deliveryEstimate || '—';
}

export default function FreightPage() {
  // ── Form state ──
  const [cepOrigem, setCepOrigem] = useState('');
  const [origemInfo, setOrigemInfo] = useState(null);
  const [origemStatus, setOrigemStatus] = useState('');

  const [cepDestino, setCepDestino] = useState('');
  const [destinoInfo, setDestinoInfo] = useState(null);
  const [destinoStatus, setDestinoStatus] = useState('');

  const [seguro, setSeguro] = useState('');

  // Packages
  const [packages, setPackages] = useState([
    { weight: 1, length: 30, width: 20, height: 10, amount: 1, content: 'Produtos personalizados' },
  ]);

  // ── Results state ──
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [sortMode, setSortMode] = useState('price');

  // ── CEP Lookup ──
  const handleLookupOrigem = useCallback(async () => {
    setOrigemStatus('Buscando…');
    try {
      const info = await lookupCep(cepOrigem);
      setOrigemInfo(info);
      setOrigemStatus(`✓ ${info.street || info.display}`);
    } catch (err) {
      setOrigemStatus(err.message);
    }
  }, [cepOrigem]);

  const handleLookupDestino = useCallback(async () => {
    setDestinoStatus('Buscando…');
    try {
      const info = await lookupCep(cepDestino);
      setDestinoInfo(info);
      setDestinoStatus(`✓ ${info.street || info.display}`);
    } catch (err) {
      setDestinoStatus(err.message);
    }
  }, [cepDestino]);

  // ── Packages ──
  const addPackage = useCallback(() => {
    setPackages(prev => [...prev, { weight: 1, length: 30, width: 20, height: 10, amount: 1, content: 'Produtos personalizados' }]);
  }, []);

  const removePackage = useCallback((idx) => {
    setPackages(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }, []);

  const updatePackage = useCallback((idx, field, value) => {
    setPackages(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }, []);

  // ── Submit ──
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const co = cepOrigem.replace(/\D/g, '');
    const cd = cepDestino.replace(/\D/g, '');
    if (co.length !== 8) { alert('Informe o CEP de origem (8 dígitos).'); return; }
    if (cd.length !== 8) { alert('Informe o CEP de destino (8 dígitos).'); return; }

    const validPkgs = packages.filter(p => Number(p.weight) > 0);
    if (validPkgs.length === 0) { alert('Informe pelo menos um pacote com peso > 0.'); return; }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const payload = {
        origin: {
          cep: co,
          city: origemInfo?.city || '',
          state: origemInfo?.state || '',
          street: origemInfo?.street || '',
        },
        destination: {
          cep: cd,
          city: destinoInfo?.city || '',
          state: destinoInfo?.state || '',
          street: destinoInfo?.street || '',
        },
        packages: validPkgs.map(p => ({
          weight: Number(p.weight),
          length: Number(p.length),
          width: Number(p.width),
          height: Number(p.height),
          amount: Number(p.amount),
          content: p.content,
        })),
        insuranceValue: seguro ? Number(seguro) : 0,
      };
      const data = await apiPost('/freight', payload);
      if (data.success && data.rates?.length) {
        setResults({ ...data, quoteRequest: payload });
      } else {
        setError(data.error || 'Nenhuma transportadora disponível para este trecho.');
      }
    } catch (err) {
      setError(err.message || 'Erro ao cotar frete.');
    } finally {
      setLoading(false);
    }
  }, [cepOrigem, cepDestino, packages, seguro, origemInfo, destinoInfo]);

  const rates = (results?.rates || []).slice().sort((a, b) => {
    if (sortMode === 'days') {
      const ad = a.deliveryDays == null ? 9999 : Number(a.deliveryDays);
      const bd = b.deliveryDays == null ? 9999 : Number(b.deliveryDays);
      if (ad !== bd) return ad - bd;
    }
    return Number(a.totalPrice || 0) - Number(b.totalPrice || 0);
  });

  const totalVolumes = packages.reduce((sum, pkg) => sum + Number(pkg.amount || 0), 0);
  const totalWeight = packages.reduce((sum, pkg) => sum + (Number(pkg.weight || 0) * Number(pkg.amount || 1)), 0);
  const firstPkg = packages[0] || {};
  const summaryOrigin = results?.origin || { cep: cepOrigem, city: origemInfo?.city, state: origemInfo?.state, street: origemInfo?.street };
  const summaryDest = results?.destination || { cep: cepDestino, city: destinoInfo?.city, state: destinoInfo?.state, street: destinoInfo?.street };

  if (results && !loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div className="rounded-xl bg-[#3498d5] text-white shadow-sm overflow-hidden">
          <div className="grid gap-5 p-6 md:grid-cols-[1fr_1fr_1fr_1.2fr]">
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-wide">
                <span className="rounded bg-[#075da4] px-3 py-1">De</span>
                <span className="h-px flex-1 border-t border-dashed border-white/40" />
              </div>
              <div className="text-2xl font-bold">{formatCep(summaryOrigin.cep)}</div>
              <div className="text-sm font-semibold">Aspen Estamparia</div>
              <div className="text-sm leading-tight text-white/95">
                {[summaryOrigin.street, summaryOrigin.city && `${summaryOrigin.city}/${summaryOrigin.state}`].filter(Boolean).join(' - ') || 'Origem'}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide">
                <span className="rounded bg-[#075da4] px-3 py-1">Para</span>
              </div>
              <div className="text-2xl font-bold">{formatCep(summaryDest.cep)}</div>
              <div className="text-sm font-semibold">Cliente</div>
              <div className="text-sm leading-tight text-white/95">
                {[summaryDest.street, summaryDest.city && `${summaryDest.city}/${summaryDest.state}`].filter(Boolean).join(' - ') || 'Destino'}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide">
                <span className="rounded bg-amber-400 px-3 py-1 text-white">Valor do seguro da carga</span>
              </div>
              <div className="text-2xl font-bold">{formatBRL(Number(results.insuranceValue || seguro || 0))}*</div>
              <div className="max-w-[240px] text-xs leading-tight text-white/95">
                *Algumas transportadoras asseguram apenas um valor parcial.
              </div>
            </div>

            <div className="flex gap-3 md:justify-end">
              <Package size={42} className="mt-8 shrink-0" />
              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-wide">
                  <span className="rounded bg-[#075da4] px-3 py-1">Volume</span>
                </div>
                <div className="text-sm font-semibold uppercase flex items-center gap-1">
                  Dimensões <Info size={13} />
                </div>
                <div className="text-xl font-bold">
                  {Number(firstPkg.length || 0)} x {Number(firstPkg.width || 0)} x {Number(firstPkg.height || 0)} cm
                </div>
                <div className="text-sm font-semibold uppercase">Peso</div>
                <div className="text-xl font-bold">{totalWeight.toLocaleString('pt-BR')} kg</div>
                <div className="text-xs text-white/90">{totalVolumes} volume{totalVolumes === 1 ? '' : 's'}</div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 px-6 pb-6">
            <Button type="button" variant="secondary" size="sm" onClick={() => setResults(null)}>
              <ArrowLeft size={14} /> Alterar dados
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={handleSubmit}>
              <RefreshCw size={14} /> Cotar novamente
            </Button>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-900">Transportadoras disponíveis</h2>
              <p className="text-sm text-muted-foreground">
                Listando todos os serviços retornados pela Envia.com para o trecho, sem agrupar por transportadora.
              </p>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Ordenar por</div>
              <div className="flex gap-2">
                <Button type="button" variant={sortMode === 'price' ? 'default' : 'outline'} size="sm" onClick={() => setSortMode('price')}>
                  Mais barato
                </Button>
                <Button type="button" variant={sortMode === 'days' ? 'default' : 'outline'} size="sm" onClick={() => setSortMode('days')}>
                  Menor prazo
                </Button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-separate border-spacing-y-3 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-[#005bab]">
                  <th className="px-5 py-2">Transportadora</th>
                  <th className="px-5 py-2">Modalidade</th>
                  <th className="px-5 py-2">Prazo estimado*</th>
                  <th className="px-5 py-2">Preço</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate, index) => {
                  const brand = carrierBrand(rate.carrier);
                  return (
                    <tr key={`${rate.carrier}-${rate.service}-${index}`} className="rounded-lg bg-white shadow-sm ring-1 ring-slate-100">
                      <td className="rounded-l-lg px-5 py-4">
                        <div className="flex h-10 w-28 items-center">
                          {brand.logo ? (
                            <img src={brand.logo} alt={brand.label} className="max-h-9 max-w-[110px] object-contain" />
                          ) : (
                            <span className="font-semibold">{brand.label}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-medium text-[#005bab] underline underline-offset-2">{cleanServiceName(rate)}</span>
                        {index === 0 && sortMode === 'price' && (
                          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Mais barato</span>
                        )}
                      </td>
                      <td className="px-5 py-4 font-semibold text-slate-900">{formatPrazo(rate)}</td>
                      <td className="px-5 py-4 font-mono font-bold text-slate-900">{formatBRL(rate.totalPrice)}</td>
                      <td className="rounded-r-lg px-5 py-4 text-right">
                        <Button type="button" className="min-w-[150px] bg-[#005bab] hover:bg-[#004b8f]">Selecionar</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Origem ── */}
          <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Truck size={16} /> CEP de Origem (Aspen)
            </h2>
            <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
              <Input
                placeholder="00000-000"
                value={cepOrigem}
                onChange={e => setCepOrigem(e.target.value)}
                onBlur={() => { const c = cepOrigem.replace(/\D/g, ''); if (c.length === 8) handleLookupOrigem(); }}
                maxLength={10}
                className="w-full"
                aria-label="CEP de origem"
              />
              <Input
                placeholder="Preenchido automaticamente"
                value={origemInfo?.display || ''}
                readOnly
                className="bg-muted/50"
                aria-label="Endereço de origem preenchido automaticamente"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleLookupOrigem}>
                <Search size={14} /> Buscar CEP Origem
              </Button>
              {origemStatus && (
                <span className={cn('text-xs', origemStatus.startsWith('✓') ? 'text-green-600' : 'text-muted-foreground')}>
                  {origemStatus}
                </span>
              )}
            </div>
          </div>

          {/* ── Destino ── */}
          <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2"><MapPin size={16} /> CEP de Destino (Cliente)</h2>
            <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
              <Input
                placeholder="00000-000"
                value={cepDestino}
                onChange={e => setCepDestino(e.target.value)}
                onBlur={() => { const c = cepDestino.replace(/\D/g, ''); if (c.length === 8) handleLookupDestino(); }}
                maxLength={10}
                className="w-full"
                aria-label="CEP de destino"
              />
              <Input
                placeholder="Preenchido automaticamente"
                value={destinoInfo?.display || ''}
                readOnly
                className="bg-muted/50"
                aria-label="Endereço de destino preenchido automaticamente"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleLookupDestino}>
                <Search size={14} /> Buscar CEP Destino
              </Button>
              {destinoStatus && (
                <span className={cn('text-xs', destinoStatus.startsWith('✓') ? 'text-green-600' : 'text-muted-foreground')}>
                  {destinoStatus}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Pacotes ── */}
        <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Package size={16} /> Pacotes
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="w-8 p-1"></th>
                  <th className="text-left p-1">Peso (kg)</th>
                  <th className="text-left p-1">Compr. (cm)</th>
                  <th className="text-left p-1">Larg. (cm)</th>
                  <th className="text-left p-1">Alt. (cm)</th>
                  <th className="text-left p-1">Qtd</th>
                  <th className="text-left p-1">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="p-1">
                      {packages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePackage(idx)}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                          aria-label={`Remover pacote ${idx + 1}`}
                        >
                          <X size={16} />
                        </button>
                      )}
                    </td>
                    <td className="p-1">
                      <Input
                        type="number" min="0.1" step="0.1"
                        className="h-8 w-20 text-sm"
                        value={pkg.weight}
                        onChange={e => updatePackage(idx, 'weight', Number(e.target.value))}
                        aria-label={`Peso do pacote ${idx + 1}`}
                      />
                    </td>
                    <td className="p-1">
                      <Input type="number" min="1" step="1" className="h-8 w-20 text-sm"
                        value={pkg.length} onChange={e => updatePackage(idx, 'length', Number(e.target.value))}
                        aria-label={`Comprimento do pacote ${idx + 1}`} />
                    </td>
                    <td className="p-1">
                      <Input type="number" min="1" step="1" className="h-8 w-20 text-sm"
                        value={pkg.width} onChange={e => updatePackage(idx, 'width', Number(e.target.value))}
                        aria-label={`Largura do pacote ${idx + 1}`} />
                    </td>
                    <td className="p-1">
                      <Input type="number" min="1" step="1" className="h-8 w-20 text-sm"
                        value={pkg.height} onChange={e => updatePackage(idx, 'height', Number(e.target.value))}
                        aria-label={`Altura do pacote ${idx + 1}`} />
                    </td>
                    <td className="p-1">
                      <Input type="number" min="1" step="1" className="h-8 w-16 text-sm"
                        value={pkg.amount} onChange={e => updatePackage(idx, 'amount', Number(e.target.value))}
                        aria-label={`Quantidade do pacote ${idx + 1}`} />
                    </td>
                    <td className="p-1">
                      <Input className="h-8 text-sm"
                        value={pkg.content} onChange={e => updatePackage(idx, 'content', e.target.value)}
                        placeholder="Descrição"
                        aria-label={`Descrição do pacote ${idx + 1}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addPackage}>
            <Plus size={14} /> Adicionar Pacote
          </Button>
        </div>

        {/* ── Seguro ── */}
        <div className="bg-white rounded-lg border shadow-sm p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><ShieldCheck size={16} /> Seguro da Carga (R$)</h2>
            <Input
              type="number" min="0" step="0.01"
              placeholder="Valor declarado (opcional)"
              value={seguro}
              onChange={e => setSeguro(e.target.value)}
              className="max-w-[220px]"
              aria-label="Valor declarado para seguro da carga"
            />
            <p className="text-xs text-muted-foreground mt-1">Opcional — enviado para a Envia.com como seguro/valor declarado da carga.</p>
          </div>
          <div className="rounded-lg bg-slate-50 border p-3 text-sm text-slate-700">
            Todas as transportadoras disponíveis no Brasil serão consultadas automaticamente.
          </div>
        </div>

        {/* ── Submit ── */}
        <Button type="submit" disabled={loading} size="lg">
          <Truck size={18} /> {loading ? 'Consultando…' : 'Cotar Frete'}
        </Button>
      </form>

      {/* ── Loading ── */}
      {loading && <SkeletonTable cols={5} rows={6} title="Consultando todas as transportadoras disponíveis…" size="lg" />}

      {/* ── Error ── */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800 space-y-2">
          <p className="font-medium">⚠️ Erro ao cotar frete</p>
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={() => setError(null)}>
            Tentar novamente
          </Button>
        </div>
      )}
    </div>
  );
}
