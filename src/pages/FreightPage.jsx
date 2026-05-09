import { useState, useCallback } from 'react';
import { Truck, Search, Plus, X, ArrowLeft, RefreshCw, Package } from 'lucide-react';
import { apiPost } from '@/lib/api.js';
import { formatBRL } from '@/lib/formatters.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';

const CARRIERS = [
  { key: '', label: 'Todas' },
  { key: 'correios', label: '📦 Correios' },
  { key: 'jadlog', label: '📦 Jadlog' },
];

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

export default function FreightPage() {
  // ── Form state ──
  const [cepOrigem, setCepOrigem] = useState('');
  const [origemInfo, setOrigemInfo] = useState(null);
  const [origemStatus, setOrigemStatus] = useState('');

  const [cepDestino, setCepDestino] = useState('');
  const [destinoInfo, setDestinoInfo] = useState(null);
  const [destinoStatus, setDestinoStatus] = useState('');

  const [seguro, setSeguro] = useState('');
  const [carrier, setCarrier] = useState('');

  // Packages
  const [packages, setPackages] = useState([
    { weight: 1, length: 30, width: 20, height: 10, amount: 1, content: 'Produtos personalizados' },
  ]);

  // ── Results state ──
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  // ── CEP Lookup ──
  const handleLookupOrigem = useCallback(async () => {
    setOrigemStatus('Buscando…');
    try {
      const info = await lookupCep(cepOrigem);
      setOrigemInfo(info);
      setOrigemStatus(`✓ ${info.street || ''}`);
    } catch (err) {
      setOrigemStatus(err.message);
    }
  }, [cepOrigem]);

  const handleLookupDestino = useCallback(async () => {
    setDestinoStatus('Buscando…');
    try {
      const info = await lookupCep(cepDestino);
      setDestinoInfo(info);
      setDestinoStatus(`✓ ${info.street || ''}`);
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

    const validPkgs = packages.filter(p => p.weight > 0);
    if (validPkgs.length === 0) { alert('Informe pelo menos um pacote com peso > 0.'); return; }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const payload = {
        origin: { cep: co },
        destination: {
          cep: cd,
          city: destinoInfo?.city || '',
          state: destinoInfo?.state || '',
        },
        packages: validPkgs.map(p => ({
          weight: Number(p.weight),
          length: Number(p.length),
          width: Number(p.width),
          height: Number(p.height),
          amount: Number(p.amount),
          content: p.content,
        })),
        carrier: carrier || undefined,
        insuranceValue: seguro ? Number(seguro) : undefined,
      };
      const data = await apiPost('/freight', payload);
      if (data.success && data.rates?.length) {
        setResults(data);
      } else {
        setError(data.error || 'Nenhuma transportadora disponível para este trecho.');
      }
    } catch (err) {
      setError(err.message || 'Erro ao cotar frete.');
    } finally {
      setLoading(false);
    }
  }, [cepOrigem, cepDestino, packages, carrier, seguro, destinoInfo]);

  // Group rates by carrier
  const groupedRates = results?.rates
    ? results.rates.reduce((acc, r) => {
        const c = r.carrier || 'Outros';
        if (!acc[c]) acc[c] = [];
        acc[c].push(r);
        return acc;
      }, {})
    : {};

  const carrierOrder = ['correios', 'jadlog', 'loggi'];
  const sortedCarriers = Object.keys(groupedRates).sort((a, b) => {
    const ai = carrierOrder.indexOf(a);
    const bi = carrierOrder.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* ── Origem ── */}
        <div className="bg-white rounded-lg border shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Truck size={16} /> CEP de Origem (Aspen)
          </h2>
          <div className="flex gap-3">
            <Input
              placeholder="00000-000"
              value={cepOrigem}
              onChange={e => setCepOrigem(e.target.value)}
              onBlur={() => { const c = cepOrigem.replace(/\D/g, ''); if (c.length === 8) handleLookupOrigem(); }}
              maxLength={10}
              className="max-w-[160px]"
            />
            <Input
              placeholder="Preenchido automaticamente"
              value={origemInfo?.display || ''}
              readOnly
              className="flex-1 bg-muted/50"
            />
          </div>
          <div className="flex items-center gap-2">
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
          <h2 className="text-sm font-semibold">CEP de Destino (Cliente)</h2>
          <div className="flex gap-3">
            <Input
              placeholder="00000-000"
              value={cepDestino}
              onChange={e => setCepDestino(e.target.value)}
              onBlur={() => { const c = cepDestino.replace(/\D/g, ''); if (c.length === 8) handleLookupDestino(); }}
              maxLength={10}
              className="max-w-[160px]"
            />
            <Input
              placeholder="Preenchido automaticamente"
              value={destinoInfo?.display || ''}
              readOnly
              className="flex-1 bg-muted/50"
            />
          </div>
          <div className="flex items-center gap-2">
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
                          className="text-muted-foreground hover:text-red-600 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </td>
                    <td className="p-1">
                      <Input
                        type="number" min="0.1" step="0.1"
                        className="h-8 w-20 text-sm"
                        value={pkg.weight}
                        onChange={e => updatePackage(idx, 'weight', Number(e.target.value))}
                      />
                    </td>
                    <td className="p-1">
                      <Input type="number" min="1" step="1" className="h-8 w-20 text-sm"
                        value={pkg.length} onChange={e => updatePackage(idx, 'length', Number(e.target.value))} />
                    </td>
                    <td className="p-1">
                      <Input type="number" min="1" step="1" className="h-8 w-20 text-sm"
                        value={pkg.width} onChange={e => updatePackage(idx, 'width', Number(e.target.value))} />
                    </td>
                    <td className="p-1">
                      <Input type="number" min="1" step="1" className="h-8 w-20 text-sm"
                        value={pkg.height} onChange={e => updatePackage(idx, 'height', Number(e.target.value))} />
                    </td>
                    <td className="p-1">
                      <Input type="number" min="1" step="1" className="h-8 w-16 text-sm"
                        value={pkg.amount} onChange={e => updatePackage(idx, 'amount', Number(e.target.value))} />
                    </td>
                    <td className="p-1">
                      <Input className="h-8 text-sm"
                        value={pkg.content} onChange={e => updatePackage(idx, 'content', e.target.value)}
                        placeholder="Descrição" />
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

        {/* ── Seguro + Transportadora ── */}
        <div className="bg-white rounded-lg border shadow-sm p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-2">Seguro da Carga (R$)</h2>
            <Input
              type="number" min="0" step="0.01"
              placeholder="Valor declarado (opcional)"
              value={seguro}
              onChange={e => setSeguro(e.target.value)}
              className="max-w-[220px]"
            />
            <p className="text-xs text-muted-foreground mt-1">Opcional — valor declarado para seguro.</p>
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-2">Transportadora</h2>
            <div className="flex gap-3 flex-wrap">
              {CARRIERS.map(c => (
                <label key={c.key} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="freightCarrier"
                    value={c.key}
                    checked={carrier === c.key}
                    onChange={() => setCarrier(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── Submit ── */}
        <Button type="submit" disabled={loading} size="lg">
          <Truck size={18} /> {loading ? 'Consultando…' : 'Cotar Frete'}
        </Button>
      </form>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex flex-col items-center py-12 text-muted-foreground gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
          Consultando transportadoras…
        </div>
      )}

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

      {/* ── Results ── */}
      {!loading && results && sortedCarriers.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">Resultados</h3>
            <span className="text-sm text-muted-foreground font-mono">
              {results.origin?.cep} → {results.destination?.cep}
            </span>
          </div>

          {sortedCarriers.map(carrierName => {
            const rates = groupedRates[carrierName];
            const carrierLabel = carrierName === 'correios' ? '📦 Correios'
              : carrierName === 'jadlog' ? '📦 Jadlog'
              : carrierName === 'loggi' ? '📦 Loggi'
              : carrierName;
            const cheapest = rates.reduce((min, r) => r.totalPrice < min.totalPrice ? r : min, rates[0]);

            return (
              <div key={carrierName} className="bg-white rounded-lg border shadow-sm overflow-hidden">
                {/* Carrier header */}
                <div className="px-5 py-3 bg-muted/30 border-b flex items-center justify-between">
                  <span className="font-semibold">{carrierLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    {rates.length} serviço{rates.length !== 1 ? 's' : ''} disponíve{rates.length !== 1 ? 'is' : 'l'}
                  </span>
                </div>

                {/* Services table */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th className="text-left p-3">Serviço</th>
                      <th className="text-left p-3">Prazo</th>
                      <th className="text-right p-3">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.map((r, i) => (
                      <tr key={i} className={cn(
                        'border-b last:border-0',
                        r.totalPrice === cheapest.totalPrice && 'bg-green-50/50',
                      )}>
                        <td className="p-3">
                          {r.serviceDescription || r.service || '—'}
                          {r.totalPrice === cheapest.totalPrice && (
                            <span className="ml-2 text-xs text-green-700 font-medium">Mais barato</span>
                          )}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {r.deliveryEstimate || (r.deliveryDays ? `${r.deliveryDays} dias` : '—')}
                        </td>
                        <td className="p-3 text-right font-mono font-semibold">
                          {formatBRL(r.totalPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
