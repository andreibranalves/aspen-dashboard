import { useState, useCallback } from 'react';
import {
  Truck,
  Search,
  Plus,
  X,
  ArrowLeft,
  RefreshCw,
  Package,
  ShieldCheck,
  MapPin,
  Info,
  Check,
  AlertTriangle,
  ArrowRight,
  Route,
  Scale,
  Ruler,
  Clock,
  Wallet,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
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
    display: `${data.localidade} / ${data.uf}${data.bairro ? ' · ' + data.bairro : ''}`,
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
  const clean = String(cep || '').replace(/\D/g, '');
  return clean.length === 8 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : cep || 'Não informado';
}

function formatPrazo(rate) {
  if (rate.deliveryDays != null && Number.isFinite(Number(rate.deliveryDays))) {
    const days = Number(rate.deliveryDays);
    return `${days} ${days === 1 ? 'dia útil' : 'dias úteis'}`;
  }
  return rate.deliveryEstimate || 'Prazo não informado';
}

function formatDecimal(value, digits = 2) {
  const number = Number(value || 0);
  return number.toLocaleString('pt-BR', {
    minimumFractionDigits: Number.isInteger(number) ? 0 : digits,
    maximumFractionDigits: digits,
  });
}

function packageStats(packages = []) {
  return packages.reduce((acc, pkg) => {
    const amount = Number(pkg.amount || 0);
    const weight = Number(pkg.weight || 0);
    const length = Number(pkg.length || 0);
    const width = Number(pkg.width || 0);
    const height = Number(pkg.height || 0);
    acc.volumes += amount;
    acc.weight += weight * amount;
    acc.cubage += ((length * width * height) / 1000000) * amount;
    return acc;
  }, { volumes: 0, weight: 0, cubage: 0 });
}

function bestRateLabel(rate, cheapest, fastest) {
  const labels = [];
  if (rate === cheapest) labels.push('Menor preço');
  if (rate === fastest && fastest !== cheapest) labels.push('Menor prazo');
  return labels;
}

function LocationCard({ kind, icon: Icon, title, cep, info, status, onCepChange, onLookup, accent = 'blue' }) {
  const valid = Boolean(info);
  const statusIsError = status && !valid && status !== 'Buscando…';

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={cn(
            'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
            accent === 'blue' ? 'bg-framer-accent-blue/10 text-framer-accent-blue' : 'bg-framer-gradient-violet/10 text-framer-gradient-violet',
          )}>
            <Icon size={18} />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{kind}</p>
            <h2 className="text-base font-semibold text-card-foreground">{title}</h2>
          </div>
        </div>
        {valid && (
          <span className="inline-flex items-center gap-1 rounded-full bg-framer-success/10 px-2.5 py-1 text-xs font-semibold text-framer-success">
            <Check size={12} /> Validado
          </span>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[150px_1fr]">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">CEP</label>
          <Input
            placeholder="00000-000"
            value={cep}
            onChange={onCepChange}
            onBlur={() => { const c = cep.replace(/\D/g, ''); if (c.length === 8) onLookup(); }}
            maxLength={10}
            className="h-11 text-base font-semibold tracking-tight"
            aria-label={`CEP ${kind.toLowerCase()}`}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Endereço encontrado</label>
          <Input
            placeholder="Cidade / UF e bairro aparecem aqui"
            value={info?.display || ''}
            readOnly
            className="h-11 bg-framer-surface-2/50"
            aria-label={`Endereço ${kind.toLowerCase()} preenchido automaticamente`}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onLookup}>
          <Search size={14} /> Validar CEP
        </Button>
        {status && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
            valid && 'bg-framer-success/10 text-framer-success',
            statusIsError && 'bg-red-500/10 text-red-600 dark:text-red-300',
            !valid && !statusIsError && 'bg-framer-surface-2 text-framer-ink-muted',
          )}>
            {valid && <Check size={12} />}
            {statusIsError && <AlertTriangle size={12} />}
            {status}
          </span>
        )}
      </div>
    </div>
  );
}

function SummaryMetric({ icon: Icon, label, value, detail }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-framer-accent-blue/10 text-framer-accent-blue">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-lg font-bold tracking-tight text-card-foreground">{value}</p>
          {detail && <p className="mt-1 text-xs leading-snug text-muted-foreground">{detail}</p>}
        </div>
      </div>
    </div>
  );
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
      setOrigemStatus(info.street || info.display);
    } catch (err) {
      setOrigemStatus(err.message);
    }
  }, [cepOrigem]);

  const handleLookupDestino = useCallback(async () => {
    setDestinoStatus('Buscando…');
    try {
      const info = await lookupCep(cepDestino);
      setDestinoInfo(info);
      setDestinoStatus(info.street || info.display);
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
      } else if (data.success && Number(seguro) > 0 && (!data.rates || data.rates.length === 0)) {
        setError('Nenhuma transportadora disponível para esse valor declarado. Tente reduzir o valor do seguro ou cotar sem seguro.');
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

  const stats = packageStats(packages);
  const firstPkg = packages[0] || {};
  const summaryOrigin = results?.origin || { cep: cepOrigem, city: origemInfo?.city, state: origemInfo?.state, street: origemInfo?.street };
  const summaryDest = results?.destination || { cep: cepDestino, city: destinoInfo?.city, state: destinoInfo?.state, street: destinoInfo?.street };
  const canQuote = cepOrigem.replace(/\D/g, '').length === 8 && cepDestino.replace(/\D/g, '').length === 8 && packages.some(p => Number(p.weight) > 0);
  const cheapestRate = rates.length ? rates.reduce((best, rate) => Number(rate.totalPrice || Infinity) < Number(best.totalPrice || Infinity) ? rate : best, rates[0]) : null;
  const fastestRate = rates.length ? rates.reduce((best, rate) => {
    const rateDays = rate.deliveryDays == null ? Infinity : Number(rate.deliveryDays);
    const bestDays = best.deliveryDays == null ? Infinity : Number(best.deliveryDays);
    return rateDays < bestDays ? rate : best;
  }, rates[0]) : null;
  const carrierCount = new Set(rates.map(rate => carrierKey(rate.carrier))).size;

  if (results && !loading) {
    return (
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[1.75rem] border border-border bg-card shadow-sm">
          <div className="grid gap-0 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="relative overflow-hidden bg-framer-accent-blue p-6 text-white md:p-8">
              <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
              <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-framer-gradient-violet/30 blur-3xl" />
              <div className="relative space-y-7">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="max-w-2xl">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/85">
                      <Sparkles size={13} /> Cotação calculada
                    </div>
                    <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">Compare preço, prazo e cobertura sem perder o contexto da carga.</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-white/82">
                      A lista abaixo já vem ordenada para decisão rápida. Use os filtros para alternar entre economia e velocidade.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => setResults(null)}>
                      <ArrowLeft size={14} /> Alterar dados
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={handleSubmit}>
                      <RefreshCw size={14} /> Cotar novamente
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                  <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/16">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/65">De</p>
                    <p className="mt-2 text-2xl font-bold tracking-tight">{formatCep(summaryOrigin.cep)}</p>
                    <p className="mt-1 text-sm font-semibold">Aspen Estamparia</p>
                    <p className="mt-1 text-sm leading-snug text-white/82">
                      {[summaryOrigin.street, summaryOrigin.city && `${summaryOrigin.city}/${summaryOrigin.state}`].filter(Boolean).join(' · ') || 'Origem'}
                    </p>
                  </div>
                  <div className="hidden items-center justify-center md:flex">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-framer-accent-blue shadow-lg shadow-black/10">
                      <ArrowRight size={20} />
                    </span>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/16">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/65">Para</p>
                    <p className="mt-2 text-2xl font-bold tracking-tight">{formatCep(summaryDest.cep)}</p>
                    <p className="mt-1 text-sm font-semibold">Cliente</p>
                    <p className="mt-1 text-sm leading-snug text-white/82">
                      {[summaryDest.street, summaryDest.city && `${summaryDest.city}/${summaryDest.state}`].filter(Boolean).join(' · ') || 'Destino'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <aside className="grid gap-3 bg-framer-surface-2/55 p-6 md:grid-cols-3 xl:grid-cols-1">
              <SummaryMetric icon={Wallet} label="Menor preço" value={cheapestRate ? formatBRL(cheapestRate.totalPrice) : 'Sem preço'} detail={cheapestRate ? `${carrierBrand(cheapestRate.carrier).label} · ${cleanServiceName(cheapestRate)}` : null} />
              <SummaryMetric icon={Clock} label="Menor prazo" value={fastestRate ? formatPrazo(fastestRate) : 'Sem prazo'} detail={fastestRate ? `${carrierBrand(fastestRate.carrier).label} · ${cleanServiceName(fastestRate)}` : null} />
              <SummaryMetric icon={Package} label="Carga" value={`${formatDecimal(stats.weight, 1)} kg`} detail={`${stats.volumes} volume${stats.volumes === 1 ? '' : 's'} · ${formatDecimal(stats.cubage, 4)} m³`} />
            </aside>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between md:p-6">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-card-foreground">Transportadoras disponíveis</h2>
                <span className="rounded-full bg-framer-surface-2 px-2.5 py-1 text-xs font-semibold text-framer-ink-muted">
                  {rates.length} serviço{rates.length === 1 ? '' : 's'} · {carrierCount} transportadora{carrierCount === 1 ? '' : 's'}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Lista única, sem agrupamento, para comparar preço final e prazo com menos leitura lateral.
              </p>
            </div>
            <div className="rounded-full bg-framer-surface-2 p-1">
              <Button type="button" variant={sortMode === 'price' ? 'default' : 'ghost'} size="sm" onClick={() => setSortMode('price')}>
                <Wallet size={14} /> Mais barato
              </Button>
              <Button type="button" variant={sortMode === 'days' ? 'default' : 'ghost'} size="sm" onClick={() => setSortMode('days')}>
                <Clock size={14} /> Menor prazo
              </Button>
            </div>
          </div>

          {results.insuranceValue > 0 && (
            <div className="mx-5 mt-5 rounded-2xl border border-framer-accent-blue/20 bg-framer-accent-blue/8 p-4 text-sm text-framer-ink-muted md:mx-6">
              <div className="flex items-start gap-3">
                <ShieldCheck size={17} className="mt-0.5 shrink-0 text-framer-accent-blue" />
                <p>Valor declarado de {formatBRL(results.insuranceValue)} aplicado. Serviços sem cobertura retornada foram ocultados para evitar uma escolha incompatível.</p>
              </div>
            </div>
          )}

          <div className="p-3 md:p-4">
            <div className="hidden grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_150px_160px] gap-4 px-4 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid">
              <span>Transportadora</span>
              <span>Serviço</span>
              <span>Prazo</span>
              <span className="text-right">Preço final</span>
            </div>

            <div className="space-y-2">
              {rates.map((rate, index) => {
                const brand = carrierBrand(rate.carrier);
                const labels = bestRateLabel(rate, cheapestRate, fastestRate);
                return (
                  <article
                    key={`${rate.carrier}-${rate.service}-${index}`}
                    className="grid gap-4 rounded-2xl border border-border bg-background p-4 transition-colors hover:border-framer-accent-blue/35 hover:bg-framer-surface-2/35 lg:grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_150px_160px] lg:items-center"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-28 shrink-0 items-center justify-center rounded-xl bg-card px-3 ring-1 ring-border">
                        {brand.logo ? (
                          <img src={brand.logo} alt={brand.label} className="max-h-9 max-w-[96px] object-contain" />
                        ) : (
                          <Truck size={20} className="text-framer-accent-blue" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-card-foreground">{brand.label}</p>
                        <p className="text-xs text-muted-foreground">Opção #{index + 1}</p>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-card-foreground">{cleanServiceName(rate)}</p>
                        {labels.map(label => (
                          <span key={label} className="rounded-full bg-framer-success/10 px-2 py-0.5 text-xs font-semibold text-framer-success">
                            {label}
                          </span>
                        ))}
                      </div>
                      {rate.insurance > 0 && (
                        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-framer-accent-blue">
                          <ShieldCheck size={12} /> Seguro Envia: {formatBRL(rate.insurance)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
                      <Clock size={15} className="text-muted-foreground" />
                      {formatPrazo(rate)}
                    </div>

                    <div className="lg:text-right">
                      <p className="font-mono text-xl font-bold tracking-tight text-card-foreground">{formatBRL(rate.totalPrice)}</p>
                      <p className="text-xs text-muted-foreground">Total retornado pela cotação</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="space-y-5">
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-framer-accent-blue text-white shadow-sm">
                <Route size={17} />
              </span>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-card-foreground">1. Rota do envio</h2>
                <p className="text-sm text-muted-foreground">Valide os CEPs para enviar cidade e UF corretos à cotação.</p>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
              <LocationCard
                kind="Origem"
                icon={Truck}
                title="Aspen Estamparia"
                cep={cepOrigem}
                info={origemInfo}
                status={origemStatus}
                onCepChange={e => setCepOrigem(e.target.value)}
                onLookup={handleLookupOrigem}
              />
              <div className="hidden lg:flex lg:justify-center">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-framer-accent-blue shadow-sm">
                  <ArrowRight size={18} />
                </span>
              </div>
              <LocationCard
                kind="Destino"
                icon={MapPin}
                title="Cliente"
                cep={cepDestino}
                info={destinoInfo}
                status={destinoStatus}
                onCepChange={e => setCepDestino(e.target.value)}
                onLookup={handleLookupDestino}
                accent="violet"
              />
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-border bg-card shadow-sm">
            <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-framer-accent-blue text-white shadow-sm">
                  <Package size={17} />
                </span>
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-card-foreground">2. Carga e volumes</h2>
                  <p className="text-sm text-muted-foreground">Peso, dimensões e quantidade definem preço, prazo e disponibilidade.</p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addPackage}>
                <Plus size={14} /> Adicionar volume
              </Button>
            </div>

            <div className="grid gap-3 border-b border-border p-4 md:grid-cols-3">
              <SummaryMetric icon={Scale} label="Peso total" value={`${formatDecimal(stats.weight, 1)} kg`} detail="Peso multiplicado pela quantidade." />
              <SummaryMetric icon={Package} label="Volumes" value={`${stats.volumes || 0}`} detail={`${packages.length} linha${packages.length === 1 ? '' : 's'} de pacote.`} />
              <SummaryMetric icon={Ruler} label="Cubagem" value={`${formatDecimal(stats.cubage, 4)} m³`} detail="Soma estimada pelas dimensões." />
            </div>

            <div className="overflow-x-auto p-3 md:p-4">
              <table className="w-full min-w-[840px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <th className="w-12 px-2 py-2">Item</th>
                    <th className="px-2 py-2">Peso</th>
                    <th className="px-2 py-2">Compr.</th>
                    <th className="px-2 py-2">Larg.</th>
                    <th className="px-2 py-2">Alt.</th>
                    <th className="px-2 py-2">Qtd</th>
                    <th className="px-2 py-2">Descrição</th>
                    <th className="w-12 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {packages.map((pkg, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-3">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-framer-surface-2 text-xs font-bold text-framer-ink-muted">
                          {idx + 1}
                        </span>
                      </td>
                      <td className="px-2 py-3">
                        <div className="relative">
                          <Input
                            type="number" min="0.1" step="0.1"
                            className="h-10 w-24 pr-9 text-sm font-semibold"
                            value={pkg.weight}
                            onChange={e => updatePackage(idx, 'weight', Number(e.target.value))}
                            aria-label={`Peso do pacote ${idx + 1}`}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">kg</span>
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <Input type="number" min="1" step="1" className="h-10 w-20 text-sm font-semibold"
                          value={pkg.length} onChange={e => updatePackage(idx, 'length', Number(e.target.value))}
                          aria-label={`Comprimento do pacote ${idx + 1}`} />
                      </td>
                      <td className="px-2 py-3">
                        <Input type="number" min="1" step="1" className="h-10 w-20 text-sm font-semibold"
                          value={pkg.width} onChange={e => updatePackage(idx, 'width', Number(e.target.value))}
                          aria-label={`Largura do pacote ${idx + 1}`} />
                      </td>
                      <td className="px-2 py-3">
                        <Input type="number" min="1" step="1" className="h-10 w-20 text-sm font-semibold"
                          value={pkg.height} onChange={e => updatePackage(idx, 'height', Number(e.target.value))}
                          aria-label={`Altura do pacote ${idx + 1}`} />
                      </td>
                      <td className="px-2 py-3">
                        <Input type="number" min="1" step="1" className="h-10 w-20 text-sm font-semibold"
                          value={pkg.amount} onChange={e => updatePackage(idx, 'amount', Number(e.target.value))}
                          aria-label={`Quantidade do pacote ${idx + 1}`} />
                      </td>
                      <td className="px-2 py-3">
                        <Input className="h-10 min-w-[220px] text-sm"
                          value={pkg.content} onChange={e => updatePackage(idx, 'content', e.target.value)}
                          placeholder="Produtos personalizados"
                          aria-label={`Descrição do pacote ${idx + 1}`} />
                      </td>
                      <td className="px-2 py-3 text-right">
                        {packages.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removePackage(idx)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600"
                            aria-label={`Remover pacote ${idx + 1}`}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="space-y-4 2xl:sticky 2xl:top-6">
          <section className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-framer-accent-blue/10 text-framer-accent-blue">
                <ShieldCheck size={18} />
              </span>
              <div>
                <h2 className="text-base font-bold text-card-foreground">3. Seguro e consulta</h2>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">Informe valor declarado somente quando a carga precisar de cobertura adicional.</p>
              </div>
            </div>

            <div className="mt-5 space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Valor declarado da carga</label>
              <Input
                type="number" min="0" step="0.01"
                placeholder="0,00"
                value={seguro}
                onChange={e => setSeguro(e.target.value)}
                className="h-11 text-base font-semibold"
                aria-label="Valor declarado para seguro da carga"
              />
              <p className="text-xs leading-5 text-muted-foreground">A Envia retorna apenas serviços que aceitam cobertura para o valor informado.</p>
            </div>

          </section>

          <section className="rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
              <SlidersHorizontal size={16} className="text-framer-accent-blue" /> Resumo antes da cotação
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Origem</span>
                <span className="font-semibold text-card-foreground">{formatCep(cepOrigem)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Destino</span>
                <span className="font-semibold text-card-foreground">{formatCep(cepDestino)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Carga</span>
                <span className="font-semibold text-card-foreground">{stats.volumes || 0} vol. · {formatDecimal(stats.weight, 1)} kg</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Seguro</span>
                <span className="font-semibold text-card-foreground">{formatBRL(Number(seguro || 0))}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Primeiro volume</span>
                <span className="font-semibold text-card-foreground">{Number(firstPkg.length || 0)} × {Number(firstPkg.width || 0)} × {Number(firstPkg.height || 0)} cm</span>
              </div>
            </div>

            <Button type="submit" disabled={loading} size="lg" className="mt-5 w-full">
              <Truck size={18} /> {loading ? 'Consultando…' : canQuote ? 'Calcular cotação' : 'Preencha rota e carga'}
            </Button>
            <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
              A próxima tela mostra todas as opções em lista comparativa.
            </p>
          </section>
        </aside>
      </form>

      {loading && <SkeletonTable cols={5} rows={6} title="Consultando todas as transportadoras disponíveis…" size="lg" />}

      {!loading && error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div className="space-y-2">
              <p className="font-semibold">Erro ao cotar frete</p>
              <p>{error}</p>
              <Button variant="outline" size="sm" onClick={() => setError(null)}>
                Tentar novamente
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
