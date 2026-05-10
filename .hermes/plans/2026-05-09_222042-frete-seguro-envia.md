# Plano — Corrigir cotação de frete com seguro Envia

## Objetivo

Fazer a página `#/freight` refletir o comportamento real da Envia.com quando o usuário informa valor declarado/seguro:

- O preço deve usar o `totalPrice` retornado pela Envia, que pode aumentar quando `insurance > 0`.
- A UI deve exibir o valor de seguro aplicado pela Envia por modalidade (`rate.insurance`), não apenas o valor declarado digitado pelo usuário.
- Quando houver seguro declarado, serviços/transportadoras que não aplicam/aceitam o seguro para aquele valor devem ser ocultados ou sinalizados conforme decisão de produto. Preferência proposta: ocultar, para espelhar o portal Envia na aba “Com serviços adicionais”.
- Manter os botões “Selecionar” removidos.

## Pesquisa realizada

### Documentação Envia

Fonte: `https://docs.envia.com/docs/additional-services`

Achados relevantes:

- `envia_insurance` é um serviço adicional disponível para parcel e LTL.
- O payload usa:

```json
{
  "additionalServices": [
    {
      "service": "envia_insurance",
      "data": { "amount": "5000" }
    }
  ]
}
```

- A documentação diz que o custo do seguro é calculado como percentual do valor declarado e aparece na resposta em `insurance`.
- A disponibilidade varia por transportadora, rota e tipo de envio.

### Verificação com API real

Foi usado o `ENVIA_TOKEN` real do projeto, sem expor a chave.

Payload de teste:

- Caixa 60 × 40 × 40 cm
- Peso 10 kg
- Origem: variáveis Aspen do `.env`
- Destino: SP/01001000
- Carriers consultados individualmente: `correios`, `jadlog`, `loggi`, `buslog`, etc.

Resultado sem seguro (`insuranceValue = 0`):

- Jadlog Package: `total=35.65`, `insurance=0.66`
- Jadlog .Com: `total=46.68`, `insurance=0.66`
- Correios, Loggi, Buslog: `insurance=0`

Resultado com seguro de R$ 10.000:

- Jadlog Package: `total=102.30`, `insurance=67.31`
- Jadlog .Com: `total=113.33`, `insurance=67.31`
- Correios, Loggi, Buslog no trecho testado retornaram `insurance=0`, com preço inalterado.

Conclusão: o comportamento é **carrier/rota/valor específico**. Minha conclusão anterior (“seguro apenas informativo”) estava incompleta. A API realmente retorna preço maior quando a transportadora aplica o seguro; quando retorna `insurance=0`, aquele serviço não aplicou/aceitou o seguro adicional para o caso.

### Comparação com prints do Andrei

Os prints mostram exatamente esse padrão:

- Sem valor declarado: aparecem Correios, Loggi, Jadlog, Buslog etc.
- Com valor declarado de R$ 10.000: a lista muda para “Com serviços adicionais” e fica restrita a poucos serviços.
- Jadlog passa a mostrar seguro de `R$ 67,31`.
- Correios Sedex, no trecho do print, mostra seguro de `R$ 153,00`.
- Serviços que não aceitam/aplicam esse seguro desaparecem.

## Diagnóstico do código atual

### Backend — `netlify/functions/freight.js`

O backend já envia os dois campos necessários:

- `packages[].declaredValue`
- `additionalServices: [{ service: 'envia_insurance', data: { amount } }]`

O problema provável está depois da resposta:

1. O backend aceita todas as tarifas retornadas, inclusive as que voltam com `insurance: 0`.
2. Isso faz transportadoras que não aplicaram o seguro continuarem aparecendo.
3. A API da Envia, quando consultada por carrier específico, pode retornar serviços com `insurance=0` mesmo com `additionalServices` no payload; o portal parece filtrá-los na visão “Com serviços adicionais”.

### Frontend — `src/pages/FreightPage.jsx`

O frontend exibe:

```jsx
Seguro declarado: {formatBRL(results.insuranceValue)}
```

Isso mostra o valor digitado pelo usuário (ex.: R$ 10.000), mas não o custo de seguro aplicado pela transportadora (ex.: R$ 67,31 ou R$ 153,00). O correto para espelhar a Envia é exibir `rate.insurance` por linha.

## Abordagem proposta

### 1. Backend: preservar valores detalhados da Envia

Em `netlify/functions/freight.js`, incluir mais campos na normalização de cada rate:

- `basePrice`
- `insurance`
- `additionalServices`
- `additionalCharges`
- `taxes`
- `totalPrice`
- `insuranceApplied: insuranceValue > 0 && normalizePrice(r.insurance) > 0`

Isso mantém auditabilidade e evita perder informação da API.

### 2. Backend: filtrar tarifas sem seguro aplicado quando houver valor declarado

Regra proposta:

```js
const requestedInsurance = insuranceValue > 0;
const insuranceCharge = normalizePrice(r.insurance);

if (requestedInsurance && insuranceCharge <= 0) {
  // logar e não incluir na lista final
  continue;
}
```

Motivo: quando o usuário informa valor declarado, ele quer opções que cubram esse valor. Se `insurance=0`, a transportadora não aplicou o serviço adicional na resposta da Envia.

### 3. Backend: logs de auditoria

Adicionar logs estruturados, sem dados sensíveis:

- início da cotação: CEP origem/destino, quantidade de pacotes, valor declarado, carriers consultados;
- por carrier: quantos rates retornaram;
- por service filtrado: carrier, service, totalPrice, insurance, motivo `insurance_not_applied`;
- resumo final: total retornado, total filtrado, insuranceValue.

Exemplo:

```js
console.info('[freight] quote', {
  originCep,
  destinationCep,
  packages: envPackages.length,
  insuranceValue,
  carriers: carriers.length,
});

console.info('[freight] filtered_no_insurance', {
  carrier,
  service: r.service,
  totalPrice: r.totalPrice,
  insurance: r.insurance,
  insuranceValue,
});
```

### 4. Frontend: mostrar seguro aplicado por linha

Em `src/pages/FreightPage.jsx`, trocar o texto por linha:

- De: `Seguro declarado: R$ 10.000,00`
- Para: `Seguro aplicado: R$ 67,31` ou `Valor declarado: R$ 67,31`, alinhado ao wording da Envia.

Proposta de wording:

```txt
Seguro Envia: R$ 67,31
```

E manter no card superior:

```txt
Valor declarado da carga: R$ 10.000,00
```

Assim fica claro:

- topo = valor da mercadoria informado pelo usuário;
- linha = custo do seguro aplicado naquela modalidade;
- preço = total já incluindo frete + seguro + taxas.

### 5. Frontend: mensagem quando todos são filtrados

Se `insuranceValue > 0` e nenhuma tarifa sobrar após filtro:

```txt
Nenhuma transportadora disponível para esse valor declarado. Tente reduzir o valor do seguro ou cotar sem seguro.
```

Se algumas foram filtradas, opcionalmente mostrar nota discreta:

```txt
Algumas transportadoras foram ocultadas porque não retornaram cobertura para o valor declarado informado.
```

### 6. Testes / validação

#### Teste backend direto

Criar script temporário ou usar curl/node inline para validar:

1. Cotação sem seguro deve retornar vários carriers.
2. Cotação com `insuranceValue=10000` deve retornar apenas rates com `insurance > 0`.
3. `totalPrice` deve bater com a API Envia.
4. Logs devem indicar os carriers filtrados.

#### Teste UI com Playwright

Fluxo:

1. Abrir `http://localhost:8888/#/freight`.
2. Preencher origem/destino/caixa 60×40×40, peso 10 kg.
3. Cotar sem seguro:
   - verificar mais carriers aparecendo;
   - nenhum botão “Selecionar”.
4. Voltar, informar seguro `10000`, cotar novamente:
   - verificar que só aparecem linhas com `Seguro Envia: R$ ...`;
   - verificar que linhas sem `rate.insurance > 0` não aparecem;
   - verificar que `Preço` é o `totalPrice` retornado, sem soma manual no frontend.

#### Build

- `npm run build`
- `node --check netlify/functions/freight.js`

### 7. Execução via Kanban quando aprovado

Quando o Andrei autorizar implementação, usar `/aspen-orchestrator` e criar tasks Kanban:

1. `researcher`: consolidar comportamento Envia seguro/API/portal e critérios de filtro.
2. `coder`: alterar `freight.js` + `FreightPage.jsx` conforme plano.
3. `reviewer`: revisar lógica de filtro, logs e UX; garantir que botões “Selecionar” não voltaram.
4. `coder` ou `reviewer`: rodar build + Playwright real.

## Arquivos prováveis de mudança

- `netlify/functions/freight.js`
- `src/pages/FreightPage.jsx`
- possivelmente `scripts/test-freight-*.mjs` temporário durante validação, removido antes de finalizar.

## Riscos / decisões abertas

1. **Filtrar vs sinalizar serviços sem seguro**
   - Proposta: filtrar, para bater com o portal Envia.
   - Alternativa: mostrar separado como “sem cobertura do valor declarado”, mas pode confundir o vendedor.

2. **Wording**
   - “Seguro Envia” é mais claro tecnicamente.
   - “Valor declarado” replica o portal, mas pode ser confundido com o valor da mercadoria.

3. **Correios com seguro**
   - No meu teste SP→SP, Correios retornou `insurance=0` para R$ 10.000.
   - No print do Andrei, Correios Sedex retornou `R$ 153,00` — isso confirma que o comportamento varia por trecho/conta/serviço.

4. **MCP Envia**
   - O MCP disponível é útil para rates básicos, mas o payload avançado com `additionalServices` e detalhes por carrier é melhor validado diretamente contra `/ship/rate/` com o `ENVIA_TOKEN` do projeto.
