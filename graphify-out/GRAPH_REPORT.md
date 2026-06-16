# Graph Report - .  (2026-06-16)

## Corpus Check
- 195 files · ~123,174 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 781 nodes · 1501 edges · 82 communities (66 shown, 16 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Functions Whatsapp Leads|Functions Whatsapp Leads]]
- [[_COMMUNITY_Functions|Functions]]
- [[_COMMUNITY_Lib Client Metadata|Lib Client Metadata]]
- [[_COMMUNITY_Lib|Lib]]
- [[_COMMUNITY_Scripts Test Whatsapp|Scripts Test Whatsapp]]
- [[_COMMUNITY_Functions Send Whatsapp|Functions Send Whatsapp]]
- [[_COMMUNITY_Pages Leaddetailpage|Pages Leaddetailpage]]
- [[_COMMUNITY_Pages Leadspage|Pages Leadspage]]
- [[_COMMUNITY_Lib Clientmetadata|Lib Clientmetadata]]
- [[_COMMUNITY_Functions Product|Functions Product]]
- [[_COMMUNITY_Package Scripts Test|Package Scripts Test]]
- [[_COMMUNITY_Bash Common|Bash Common]]
- [[_COMMUNITY_Functions Sales Dashboard|Functions Sales Dashboard]]
- [[_COMMUNITY_Components|Components]]
- [[_COMMUNITY_Scripts App Server|Scripts App Server]]
- [[_COMMUNITY_Unit Pricing Test|Unit Pricing Test]]
- [[_COMMUNITY_Functions Quotations|Functions Quotations]]
- [[_COMMUNITY_Package Devdependencies|Package Devdependencies]]
- [[_COMMUNITY_Functions Extract|Functions Extract]]
- [[_COMMUNITY_Functions Product Pricing|Functions Product Pricing]]
- [[_COMMUNITY_Scripts Playwright Test|Scripts Playwright Test]]
- [[_COMMUNITY_Layout Layout|Layout Layout]]
- [[_COMMUNITY_Pages Freightpage|Pages Freightpage]]
- [[_COMMUNITY_Functions Sales Orders|Functions Sales Orders]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_Specify Extensions Git|Specify Extensions Git]]
- [[_COMMUNITY_Lib Formatters|Lib Formatters]]
- [[_COMMUNITY_Functions Freight|Functions Freight]]
- [[_COMMUNITY_Pages Productdetailpage|Pages Productdetailpage]]
- [[_COMMUNITY_Pages Productspage|Pages Productspage]]
- [[_COMMUNITY_Specify Scripts Bash|Specify Scripts Bash]]
- [[_COMMUNITY_Powershell Create New|Powershell Create New]]
- [[_COMMUNITY_Vercel|Vercel]]
- [[_COMMUNITY_Pages Settingspage Step|Pages Settingspage Step]]
- [[_COMMUNITY_Tests Orcamento Spec|Tests Orcamento Spec]]
- [[_COMMUNITY_Functions Products|Functions Products]]
- [[_COMMUNITY_Functions Sales Order|Functions Sales Order]]
- [[_COMMUNITY_Pages Quotationspage|Pages Quotationspage]]
- [[_COMMUNITY_Lib Printformats|Lib Printformats]]
- [[_COMMUNITY_Pages Salesorderspage|Pages Salesorderspage]]
- [[_COMMUNITY_Ui Table|Ui Table]]
- [[_COMMUNITY_Functions Leads Clients|Functions Leads Clients]]
- [[_COMMUNITY_Hooks Useextractiondrafts|Hooks Useextractiondrafts]]
- [[_COMMUNITY_Lib Api|Lib Api]]
- [[_COMMUNITY_Scripts Playwright Test|Scripts Playwright Test]]
- [[_COMMUNITY_Bash Git Common|Bash Git Common]]
- [[_COMMUNITY_Lib Productcache|Lib Productcache]]
- [[_COMMUNITY_Scripts Test Manual|Scripts Test Manual]]
- [[_COMMUNITY_Scripts Test Product|Scripts Test Product]]
- [[_COMMUNITY_Components Qualitybadges|Components Qualitybadges]]
- [[_COMMUNITY_Components Statusbadge Status|Components Statusbadge Status]]
- [[_COMMUNITY_Package|Package]]
- [[_COMMUNITY_Pages Manualorcamentopage|Pages Manualorcamentopage]]
- [[_COMMUNITY_Powershell Git Common|Powershell Git Common]]
- [[_COMMUNITY_Ui Button|Ui Button]]
- [[_COMMUNITY_Bash Auto Commit|Bash Auto Commit]]
- [[_COMMUNITY_Bash Initialize Repo|Bash Initialize Repo]]
- [[_COMMUNITY_Components Draftreviewcard|Components Draftreviewcard]]
- [[_COMMUNITY_Components Emptystate|Components Emptystate]]
- [[_COMMUNITY_Pages Dashboardpage|Pages Dashboardpage]]
- [[_COMMUNITY_Pages Salesorderdetailpage|Pages Salesorderdetailpage]]
- [[_COMMUNITY_Ui Badge|Ui Badge]]
- [[_COMMUNITY_Bash Check Prerequisites|Bash Check Prerequisites]]
- [[_COMMUNITY_Bash Setup Plan|Bash Setup Plan]]
- [[_COMMUNITY_Bash Setup Tasks|Bash Setup Tasks]]
- [[_COMMUNITY_Lib Constants|Lib Constants]]
- [[_COMMUNITY_Ui Input|Ui Input]]
- [[_COMMUNITY_Vite Config|Vite Config]]

## God Nodes (most connected - your core abstractions)
1. `erpGetList()` - 48 edges
2. `createHttpError()` - 47 edges
3. `erpGetDoc()` - 35 edges
4. `erpPost()` - 24 edges
5. `handler()` - 22 edges
6. `erpPut()` - 21 edges
7. `cn()` - 20 edges
8. `runQuotePipeline()` - 19 edges
9. `scripts` - 19 edges
10. `LeadDetailPage()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `assert()`  [INFERRED]
  scripts/playwright-test-product-detail.mjs → test_local.mjs
- `EmptyState()` --calls--> `cn()`  [INFERRED]
  src/components/EmptyState.jsx → src/lib/utils.js
- `QualityBadges()` --calls--> `cn()`  [INFERRED]
  src/components/QualityBadges.jsx → src/lib/utils.js
- `StatusBadge()` --calls--> `cn()`  [INFERRED]
  src/components/StatusBadge.jsx → src/lib/utils.js
- `Sidebar()` --calls--> `cn()`  [INFERRED]
  src/components/layout/Sidebar.jsx → src/lib/utils.js

## Import Cycles
- None detected.

## Communities (82 total, 16 thin omitted)

### Community 0 - "Functions Whatsapp Leads"
Cohesion: 0.12
Nodes (33): assertEvolutionConfig(), cleanText(), composeConversationText(), _contactMapCache, _convertedKeysCache, EVOLUTION_BASE_URL, evolutionFetch(), extractFallback() (+25 more)

### Community 1 - "Functions"
Cohesion: 0.10
Nodes (29): handler(), ROUTES, createHttpError(), editDraftWithOpenRouter(), extractAssistantText(), handler(), parseJsonSafely(), unwrapJsonText() (+21 more)

### Community 2 - "Lib Client Metadata"
Cohesion: 0.17
Nodes (28): ALLOWED_DOCTYPES, buildErpUrl(), buildSummaryAddress(), computeQualityFlags(), EDITABLE_FIELDS, handleGet(), handlePut(), handler() (+20 more)

### Community 3 - "Lib"
Cohesion: 0.11
Nodes (25): handler(), handler(), getPrintFormatLabel(), normalizePrintFormat(), PRINT_FORMATS, resolvePrintFormat(), shouldIncludePrintFormatParam(), escapeRegExp() (+17 more)

### Community 4 - "Scripts Test Whatsapp"
Cohesion: 0.11
Nodes (27): WhatsAppSendPanel(), createId(), DEFAULT_WA_FLOWS, fetchFlowsFromApi(), FLOW_DEFAULTS, flowToSequencePayload(), getFlowSummary(), getLocalStorage() (+19 more)

### Community 5 - "Functions Send Whatsapp"
Cohesion: 0.14
Nodes (30): absoluteUrl(), assertEvolutionConfig(), buildSequenceSteps(), CATEGORY_ALIASES, DEFAULT_SEQUENCE_STEPS, detectCategories(), dispatchN8n(), EVOLUTION_BASE_URL (+22 more)

### Community 6 - "Pages Leaddetailpage"
Cohesion: 0.13
Nodes (16): addressLine(), CONTRIBUINTE_OPTS, formatCnpj(), formatCpf(), formatTaxId(), getDoctype(), getInitials(), inputClass() (+8 more)

### Community 7 - "Pages Leadspage"
Cohesion: 0.14
Nodes (20): buildCrmDealErpUrl(), buildCustomerErpUrl(), buildErpDocUrl(), buildLeadErpUrl(), buildQuotationErpUrl(), buildSalesOrderErpUrl(), CONTRIBUINTE_OPTS, formatCnpj() (+12 more)

### Community 8 - "Lib Clientmetadata"
Cohesion: 0.24
Nodes (15): CustomerMetadataForm(), accInsensitive(), EMPTY_ADDRESS, formatAddressSummary(), formatCnpj(), getLeadSourceLabel(), hasAnyAddressField(), hasMinimumAddressForErp() (+7 more)

### Community 9 - "Functions Product"
Cohesion: 0.21
Nodes (12): handler(), handler(), handler(), upsertBracket(), handler(), buildHeaders(), erpDelete(), erpPut() (+4 more)

### Community 10 - "Package Scripts Test"
Cohesion: 0.11
Nodes (19): scripts, build, check, dev, dev:vercel, format, format:check, lint (+11 more)

### Community 11 - "Bash Common"
Cohesion: 0.12
Nodes (4): get_current_branch(), get_feature_paths(), has_git(), common.sh script

### Community 12 - "Functions Sales Dashboard"
Cohesion: 0.23
Nodes (16): computeConversionRate(), computeSalesByDay(), computeSummary(), computeTopCustomers(), computeTopProducts(), fetchSalesOrderItems(), fetchSalesOrders(), fetchStaleQuotations() (+8 more)

### Community 13 - "Components"
Cohesion: 0.13
Nodes (8): ContextActions(), DetailDrawer(), ErrorState(), PageHeader(), Skeleton(), cn(), LocationCard(), LoginPage()

### Community 14 - "Scripts App Server"
Cohesion: 0.15
Nodes (7): handler(), PIPELINE_ORDER, handler(), MIME_TYPES, PORT, ROUTES, server

### Community 15 - "Unit Pricing Test"
Cohesion: 0.24
Nodes (6): fetchPricingRuleRate(), getBracket(), getRate(), getUrgentRate(), fetchItemNames(), handler()

### Community 16 - "Functions Quotations"
Cohesion: 0.22
Nodes (13): ALL_STATUS_KEYS, buildListFilters(), buildSearchOrFilters(), computeStatusSummary(), handleDetail(), handleList(), handler(), handleUpdate() (+5 more)

### Community 17 - "Package Devdependencies"
Cohesion: 0.13
Nodes (15): devDependencies, autoprefixer, eslint, eslint-config-prettier, @eslint/js, playwright, @playwright/test, postcss (+7 more)

### Community 18 - "Functions Extract"
Cohesion: 0.29
Nodes (12): ALLOWED_IMAGE_MIME_TYPES, buildSystemPrompt(), buildUserContent(), createHttpError(), estimateBase64Bytes(), extractAssistantText(), extractWithOpenRouter(), handler() (+4 more)

### Community 19 - "Functions Product Pricing"
Cohesion: 0.30
Nodes (12): handler(), BRACKETS, fetchItemPrice(), fetchPricingRuleByTitle(), formatPriceRow(), handler(), isErpNotFound(), json() (+4 more)

### Community 20 - "Scripts Playwright Test"
Cohesion: 0.35
Nodes (13): check(), FAIL, main(), PASS, testAutoPage(), testCrmKanban(), testFreightPage(), testLeadsPage() (+5 more)

### Community 21 - "Layout Layout"
Cohesion: 0.17
Nodes (7): useDarkMode(), getBreadcrumb(), Layout(), PAGE_LABELS, SetTopBarActionsCtx, NAV_SECTIONS, Sidebar()

### Community 22 - "Pages Freightpage"
Cohesion: 0.26
Nodes (9): CARRIER_BRANDS, carrierBrand(), carrierKey(), cleanServiceName(), formatCep(), formatDecimal(), formatPrazo(), FreightPage() (+1 more)

### Community 23 - "Functions Sales Orders"
Cohesion: 0.27
Nodes (11): attachSourceQuotations(), buildListFilters(), getPeriodDates(), getSourceQuotationFromDoc(), handleDetail(), handleList(), handler(), ITEM_FIELDS (+3 more)

### Community 24 - "Package Dependencies"
Cohesion: 0.17
Nodes (12): dependencies, class-variance-authority, clsx, dotenv, lucide-react, puppeteer-core, react, react-dom (+4 more)

### Community 25 - "Specify Extensions Git"
Cohesion: 0.20
Nodes (3): create-new-feature.sh script, _extract_highest_number(), get_highest_from_branches()

### Community 26 - "Lib Formatters"
Cohesion: 0.31
Nodes (7): SplitResultCard(), capitalize(), fmtPhone(), formatBRL(), formatPhoneInput(), normalizePhoneDigits(), ManualOrcamentoPage()

### Community 27 - "Functions Freight"
Cohesion: 0.29
Nodes (10): ASPEN_ORIGIN, BR_CARRIERS, BRASPRESS_MODALS, CEP_STATE_BY_PREFIX, cleanCep(), fetchBraspressRates(), handler(), inferStateFromCep() (+2 more)

### Community 28 - "Pages Productdetailpage"
Cohesion: 0.20
Nodes (6): formatDate(), BRACKETS, formatPct(), ProductDetailPage(), QuotationDetailPage(), STATUS_LABELS

### Community 29 - "Pages Productspage"
Cohesion: 0.22
Nodes (6): useHashRoute(), PAGE_SIZES, ProductsPage(), SORT_OPTIONS, App(), renderPage()

### Community 30 - "Specify Scripts Bash"
Cohesion: 0.25
Nodes (3): create-new-feature.sh script, _extract_highest_number(), get_highest_from_branches()

### Community 31 - "Powershell Create New"
Cohesion: 0.39
Nodes (7): ConvertTo-CleanBranchName(), Get-BranchName(), Get-HighestNumberFromBranches(), Get-HighestNumberFromNames(), Get-HighestNumberFromRemoteRefs(), Get-HighestNumberFromSpecs(), Get-NextBranchNumber()

### Community 32 - "Vercel"
Cohesion: 0.22
Nodes (8): maxDuration, buildCommand, functions, api/[...path].js, installCommand, outputDirectory, rewrites, $schema

### Community 33 - "Pages Settingspage Step"
Cohesion: 0.25
Nodes (5): PREVIEW_CONTEXT, STEP_TYPE_DESCRIPTIONS, STEP_TYPE_ICONS, STEP_TYPE_LABELS, STEP_TYPE_OPTIONS

### Community 34 - "Tests Orcamento Spec"
Cohesion: 0.25
Nodes (5): MOCK_EXTRACT, MOCK_LEAD_DETAIL, MOCK_LEADS_LIST, MOCK_ORCAMENTO, MOCK_WHATSAPP_LEADS

### Community 35 - "Functions Products"
Cohesion: 0.48
Nodes (6): buildFilters(), buildOrFilters(), handler(), mapItem(), parsePageLimit(), stripHtml()

### Community 36 - "Functions Sales Order"
Cohesion: 0.57
Nodes (6): checkDuplicate(), handler(), normaliseMappedDoc(), resolveDocName(), tryUpdateCrmDeal(), erpCallMethod()

### Community 37 - "Pages Quotationspage"
Cohesion: 0.29
Nodes (6): useSetTopBarActions(), PAGE_SIZES, QuotationsPage(), STATUS_DISPLAY, STATUS_LABELS, STATUSES

### Community 38 - "Lib Printformats"
Cohesion: 0.43
Nodes (5): buildQuotationViewUrl(), loadActivePrintFormat(), normalizePrintFormat(), PRINT_FORMAT_OPTIONS, saveActivePrintFormat()

### Community 39 - "Pages Salesorderspage"
Cohesion: 0.29
Nodes (5): PERIODS, SalesOrdersPage(), STATUS_DISPLAY, STATUS_LABELS, STATUSES

### Community 40 - "Ui Table"
Cohesion: 0.29
Nodes (6): Table, TableBody, TableCell, TableHead, TableHeader, TableRow

### Community 41 - "Functions Leads Clients"
Cohesion: 0.47
Nodes (3): buildSearchFilter(), handler(), parsePageLimit()

### Community 42 - "Hooks Useextractiondrafts"
Cohesion: 0.33
Nodes (3): useExtractionDrafts(), useImageInput(), AutoQuotePage()

### Community 43 - "Lib Api"
Cohesion: 0.60
Nodes (5): apiDelete(), apiGet(), apiPost(), apiPut(), request()

### Community 44 - "Scripts Playwright Test"
Cohesion: 0.47
Nodes (5): check(), FAIL, main(), PASS, testResponsive()

### Community 46 - "Lib Productcache"
Cohesion: 0.50
Nodes (3): cache, getKey(), searchProducts()

### Community 47 - "Scripts Test Manual"
Cohesion: 0.50
Nodes (4): check(), FAIL, main(), PASS

### Community 48 - "Scripts Test Product"
Cohesion: 0.50
Nodes (4): check(), FAIL, PASS, testProductDetail()

### Community 49 - "Components Qualitybadges"
Cohesion: 0.50
Nodes (3): QualityBadges(), typeIcons, typeStyles

### Community 50 - "Components Statusbadge Status"
Cohesion: 0.50
Nodes (3): STATUS_ICONS, STATUS_STYLES, StatusBadge()

### Community 51 - "Package"
Cohesion: 0.50
Nodes (3): name, type, version

### Community 54 - "Ui Button"
Cohesion: 0.50
Nodes (3): Button, sizes, variants

## Knowledge Gaps
- **181 isolated node(s):** `auto-commit.sh script`, `create-new-feature.sh script`, `git-common.sh script`, `initialize-repo.sh script`, `check-prerequisites.sh script` (+176 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Components` to `Lib Formatters`, `Scripts Test Whatsapp`, `Lib Clientmetadata`, `Hooks Useextractiondrafts`, `Components Qualitybadges`, `Components Statusbadge Status`, `Layout Layout`, `Components Draftreviewcard`, `Components Emptystate`, `Ui Badge`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `formatBRL()` connect `Lib Formatters` to `Pages Quotationspage`, `Pages Leaddetailpage`, `Pages Salesorderspage`, `Pages Productdetailpage`, `Pages Freightpage`, `Components Draftreviewcard`, `Pages Dashboardpage`, `Pages Salesorderdetailpage`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `ManualOrcamentoPage()` connect `Lib Formatters` to `Lib Clientmetadata`, `Pages Manualorcamentopage`, `Components`, `Lib Printformats`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `auto-commit.sh script`, `create-new-feature.sh script`, `git-common.sh script` to the rest of the system?**
  _181 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Functions Whatsapp Leads` be split into smaller, more focused modules?**
  _Cohesion score 0.11605937921727395 - nodes in this community are weakly interconnected._
- **Should `Functions` be split into smaller, more focused modules?**
  _Cohesion score 0.1006006006006006 - nodes in this community are weakly interconnected._
- **Should `Lib` be split into smaller, more focused modules?**
  _Cohesion score 0.10756302521008404 - nodes in this community are weakly interconnected._