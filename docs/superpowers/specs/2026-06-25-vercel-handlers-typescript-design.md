# Design: Migrate Vercel serverless handlers in `api/` from `.js` to `.ts`

## 1. Objective and scope

Convert every Vercel serverless function source file under `api/` from JavaScript to TypeScript, without changing runtime behavior, API contracts, or business logic.

**In scope:**

- All 49 `.js` files under `api/`:
  - 1 catch-all router: `api/[...path].js`
  - 36 handlers: `api/_functions/*.js`
  - 12 shared libraries: `api/_functions/lib/*.js` and `api/_lib/*.js`
- Shared runtime types for the legacy Lambda-shaped handlers.
- `tsconfig` adjustments so `api/` type-checks and emits.
- `package.json` / `vercel.json` build orchestration.
- `scripts/dev-api-server.mjs` and `scripts/app-server.mjs` import paths.

**Out of scope:**

- Frontend source (`src/`).
- Scripts outside the API surface (`scripts/*.mjs`, `test_local.mjs`, tests).
- Runtime dependency additions.
- Changing handler signatures or the `function-adapter` contract.
- Rewriting business logic, pricing rules, ERPNext client behavior, or auth/rate-limit semantics.

## 2. Context

### 2.1 Current API layout

```
api/
├── [...path].js                  ← single Vercel function entrypoint
├── _functions/                   ← legacy Lambda-shaped handlers
│   ├── extract.js
│   ├── orcamento.js
│   ├── login.js
│   ├── logout.js
│   ├── products.js
│   ├── … (31 more)
│   └── lib/
│       ├── erpnext.js
│       ├── quote-pipeline.js
│       ├── quotation-pdf.js
│       └── … (9 more)
└── _lib/
    ├── auth.js
    ├── function-adapter.js
    ├── media-schema.js
    └── rate-limit.js
```

`api/[...path].js` is the only Vercel Function declared in `vercel.json`. It authenticates, rate-limits, dispatches to a `ROUTES` map, and uses `wrapFunctionHandler` from `api/_lib/function-adapter.js` to convert the Express/Vercel `req/res` shape into the legacy Lambda event that the individual handlers expect.

### 2.2 How the adapter, auth, and rate-limit are used

- **`function-adapter.js`** exposes `toFunctionEvent(req)`, `sendFunctionResult(res, result)`, and `wrapFunctionHandler(handler)`. It is the single bridge between Vercel's `req/res` runtime and the project's `{statusCode, headers, body}` Lambda contract.
- **`auth.js`** exposes `isAuthenticated(req)`, `getRouteName(req)`, and `parseCookies(header)`. It is called directly by `api/[...path].js` before dispatch. It is intentionally skipped by the local dev servers.
- **`rate-limit.js`** exposes `checkRateLimit(req)`. It reads `ROUTE_LIMITS` keyed by `getRouteName(req)`. Also skipped locally.

Both `auth.js` and `rate-limit.js` operate on Node `IncomingMessage`-like objects, not on the legacy Lambda event.

### 2.3 Build/runtime configuration

- `package.json` has `"type": "module"` and `typescript` as a dev dependency.
- `tsconfig.json` already includes `"api/**/*"`, uses `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"allowJs": true`, and `"noEmit": true`.
- `vite.config.js` builds the React frontend into `public/`.
- `vercel.json` points the only function at `api/[...path].js` with `maxDuration: 60`.
- Local dev servers (`scripts/dev-api-server.mjs`, `scripts/app-server.mjs`) duplicate the `ROUTES` map and import handlers directly from `api/_functions/*.js`.

### 2.4 Vercel TypeScript support

Vercel's Node.js runtime compiles TypeScript files inside `/api` automatically and supports ESM when `"type": "module"` is set ([Vercel Functions – Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js)). However, Vercel's bundler does **not** rewrite `.ts` import specifiers to `.js` automatically. The safest convention for ESM + TypeScript is to write imports with `.js` extensions in source (e.g. `import { handler } from './orcamento.js'`) and let the compiler/bundler resolve them to the `.ts` source files.

Node.js 24 (the runtime used locally) supports native type stripping, but it also does **not** rewrite `.js` specifiers to `.ts` files at runtime. Therefore a source-only `.ts` layout that relies on Vercel's compiler would break the local dev servers unless we also introduce a local loader or pre-build step. The recommended approach below solves this by emitting compiled `.js` artifacts that both Vercel and local dev consume.

## 3. Approaches

### 3.1 Native Vercel TypeScript (rename only)

Rename all `api/**/*.js` to `api/**/*.ts`, keep imports with `.js` extensions (TypeScript ESM convention), and update `vercel.json` to point at `api/[...path].ts`. Vercel compiles the files during its own build.

**Trade-offs:**

- ✅ No local build step for Vercel deployments.
- ❌ Local dev servers (`scripts/dev-api-server.mjs`, `scripts/app-server.mjs`) cannot import `.ts` files directly with plain Node unless we add a loader such as `tsx` or `ts-node`.
- ❌ Import extension mismatch risk: Node 24's native type-stripping requires `.ts` imports, while Vercel's bundler works best with `.js` imports. Picking one convention breaks the other environment.
- ❌ Harder to debug because the code run in production is transpiled by Vercel, not by our own `tsconfig`.

### 3.2 Source `.ts` with explicit `tsc` emit (recommended)

Keep authoritative source as `api/**/*.ts`. Add an API-specific `tsconfig.api.json` that emits compiled `.js` into the same `api/` tree (side-by-side with `.ts` source). Vercel and local dev both run the emitted `.js` files. Generated `.js` files are gitignored.

**Trade-offs:**

- ✅ Local dev and production run the exact same compiled JavaScript.
- ✅ No extra runtime dependency; uses the existing `typescript` dev dependency.
- ✅ Import specifiers stay `.js`, matching existing ESM conventions.
- ✅ Vercel function discovery continues to use the conventional `api/[...path].js` entrypoint.
- ❌ Generated `.js` files live next to source during development (mitigated by `.gitignore`).
- ❌ One extra build step before `vite build`.

### 3.3 Source `.ts` with separate output directory

Same as 3.2, but emit compiled JS to a separate directory such as `ts-out/api/`. Update `vercel.json` to point functions at `ts-out/api/[...path].js` and rewrite `/api/*` to that file.

**Trade-offs:**

- ✅ Clean separation between source and build artifacts.
- ❌ `vercel.json` function paths become non-standard, and local dev servers must import from `ts-out/api/...`.
- ❌ Higher risk that Vercel's routing/function discovery treats a non-`api/` path differently.

### 3.4 Comparison summary

| Approach | Local/prod parity | Build step | Import extensions | Risk |
|---|---|---|---|---|
| 3.1 Native Vercel TS | Low | None | `.js` works for Vercel, breaks Node native TS | High |
| **3.2 `tsc` emit in-place** | **High** | **`tsc`** | **`.js` everywhere** | **Low** |
| 3.3 `tsc` emit to `ts-out/` | High | `tsc` | `.js` everywhere | Medium (non-standard Vercel path) |

## 4. Recommended approach: 3.2 — source `.ts` with `tsc` emit in `api/`

### 4.1 Target layout after migration

```
api/
├── tsconfig.api.json             ← new: emit config for the API
├── [...path].ts                  ← was .js
├── [...path].js                  ← emitted by tsc, gitignored
├── _functions/
│   ├── extract.ts
│   ├── extract.js                ← emitted, gitignored
│   ├── orcamento.ts
│   ├── orcamento.js              ← emitted, gitignored
│   ├── …
│   └── lib/
│       ├── erpnext.ts
│       ├── erpnext.js            ← emitted, gitignored
│       └── …
└── _lib/
    ├── types.ts                  ← new: shared runtime types
    ├── function-adapter.ts
    ├── function-adapter.js       ← emitted, gitignored
    ├── auth.ts
    ├── auth.js                   ← emitted, gitignored
    ├── media-schema.ts
    ├── rate-limit.ts
    └── rate-limit.js             ← emitted, gitignored
```

`.gitignore` adds `api/**/*.js` once the migration is complete.

### 4.2 Shared types

Create `api/_lib/types.ts` to centralize the legacy Lambda contract:

```ts
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';

export type FunctionHeaders = Record<string, string | string[] | undefined>;

export interface FunctionEvent {
  httpMethod: HttpMethod | string;
  headers: FunctionHeaders;
  queryStringParameters: Record<string, string | undefined>;
  body: string;
  url: string;
}

export interface FunctionResult {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
}

export type LegacyHandler = (event: FunctionEvent) => Promise<FunctionResult>;
```

`function-adapter.ts` imports these types. Individual handlers import `FunctionEvent` and `FunctionResult` and use them for their `handler` signatures.

### 4.3 Import and extension strategy

- Keep all relative imports with `.js` extensions, matching the existing ESM style:
  ```ts
  import { handler as orcamento } from './_functions/orcamento.js';
  import { wrapFunctionHandler } from './_lib/function-adapter.js';
  import type { FunctionEvent, FunctionResult } from './_lib/types.js';
  ```
- Use `import type { … }` for type-only imports so the emitted JS stays clean.
- Do not introduce path aliases such as `@api/*`; the API does not use them today.
- Do not switch to `.ts` import specifiers; doing so risks runtime failures because neither Vercel's bundler nor Node's type-stripping rewrite them.

### 4.4 `tsconfig.api.json`

Located at `api/tsconfig.api.json`, extending the root config and overriding only what is needed to emit:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": false,
    "sourceMap": true,
    "outDir": ".",
    "rootDir": "."
  },
  "include": ["./**/*"],
  "exclude": ["**/*.js", "**/*.d.ts"]
}
```

Notes:

- `allowImportingTsExtensions` from the root config must not be active here because we are emitting JS. Since we use `.js` imports, that option is unnecessary.
- `module: ESNext` and `moduleResolution: bundler` are inherited from the root config; they let TypeScript resolve `.js` imports to `.ts` source files for type-checking while preserving the `.js` specifier in the emit.

### 4.5 Build pipeline

Update `package.json` scripts:

```json
{
  "scripts": {
    "build:api": "tsc -p api/tsconfig.api.json",
    "build": "npm run build:api && vite build",
    "type-check": "tsc --noEmit",
    "dev:api": "tsc -p api/tsconfig.api.json --watch"
  }
}
```

Update `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "npm install",
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "functions": {
    "api/[...path].js": {
      "maxDuration": 60
    }
  },
  "rewrites": [
    {
      "source": "/((?!api/.*).*)",
      "destination": "/index.html"
    }
  ]
}
```

The function entrypoint stays `api/[...path].js`; that file is produced by `npm run build:api` before Vite runs.

### 4.6 Local dev alignment

- `scripts/dev-api-server.mjs` and `scripts/app-server.mjs` continue to import handlers from the emitted `.js` files under `api/_functions/`.
- Before starting local dev, run `npm run build:api` once. During active backend work, run `npm run dev:api` in a separate terminal so `.ts` changes recompile.
- `npm run dev` (Vite on port 5173) proxies `/api` to `http://localhost:8888`, so the local API server must be running with compiled handlers.

## 5. Components and files

| Area | Action |
|---|---|
| `api/[...path].js` | Rename to `.ts`, add types for `req`, `res`, and the `ROUTES` map. |
| `api/_functions/*.js` | Rename all 36 handlers to `.ts`; type `handler(event)` signatures. |
| `api/_functions/lib/*.js` | Rename all 10 lib files to `.ts`; add return types for exported helpers. |
| `api/_lib/*.js` | Rename to `.ts`; `function-adapter.ts`, `auth.ts`, `rate-limit.ts`, `media-schema.ts`. |
| `api/_lib/types.ts` | New shared types for the Lambda event/result contract. |
| `api/tsconfig.api.json` | New emit configuration. |
| `package.json` | Add `build:api` and `dev:api` scripts; update `build` to run API build first. |
| `vercel.json` | No path change required; keep `api/[...path].js`. |
| `.gitignore` | Add `api/**/*.js` once migration is complete. |
| `scripts/dev-api-server.mjs` | Ensure imports point to emitted `.js` handlers. |
| `scripts/app-server.mjs` | Ensure imports point to emitted `.js` handlers. |
| `eslint.config.js` | Already lints `api/**/*.{js,ts}`; no change needed. |

## 6. Data flow / examples

### 6.1 Adapter flow (unchanged)

```
Vercel request
    │
    ▼
api/[...path].js  ←  auth + rate-limit + route lookup
    │
    ▼
wrapFunctionHandler(routeHandler)
    │
    ▼
toFunctionEvent(req)  →  { httpMethod, headers, queryStringParameters, body, url }
    │
    ▼
api/_functions/<handler>.js  →  { statusCode, headers, body }
    │
    ▼
sendFunctionResult(res, result)
```

After migration, every box is a `.ts` source file, but Vercel and local dev execute the emitted `.js` files.

### 6.2 Handler before / after

**Before (`api/_functions/orcamento.js`):**

```js
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  // … business logic unchanged
}
```

**After (`api/_functions/orcamento.ts`):**

```ts
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  // … identical business logic
}
```

### 6.3 Adapter after

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FunctionEvent, FunctionResult, LegacyHandler } from './types.js';

export function toFunctionEvent(req: IncomingMessage): FunctionEvent { … }

export function sendFunctionResult(
  res: ServerResponse,
  result: FunctionResult,
): void { … }

export function wrapFunctionHandler(handler: LegacyHandler) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const result = await handler(toFunctionEvent(req));
    sendFunctionResult(res, result);
  };
}
```

## 7. Build/deploy steps

1. **Add shared types** — create `api/_lib/types.ts`.
2. **Add API emit config** — create `api/tsconfig.api.json`.
3. **Rename files** — use `git mv` to rename every `api/**/*.js` to `.ts`.
4. **Add minimal types** — type handler signatures, adapter helpers, and shared lib exports. Do not refactor logic.
5. **Update imports to type-only where appropriate** — use `import type` for interfaces/types.
6. **Update `package.json`** — add `build:api` and `dev:api`, change `build` to `npm run build:api && vite build`.
7. **Update `.gitignore`** — ignore `api/**/*.js`.
8. **Update local dev servers** — ensure imports reference the emitted `.js` files.
9. **Local verification** — run `npm run build:api`, then `npm run type-check`, then start `scripts/dev-api-server.mjs`.
10. **Preview deploy** — push to a branch, let Vercel build the preview, and run the smoke tests listed below.
11. **Production deploy** — only after preview validation succeeds, run `vercel --prod` (or merge the branch if CI is connected).

## 8. Mandatory preview deploy validation

Before promoting to production, validate the preview URL against real ERPNext/staging data:

| Endpoint | Check |
|---|---|
| `POST /api/login` | Returns cookie and `{ success: true }`. |
| `GET /api/products` | Authenticated list returns products. |
| `POST /api/extract` | Extracts items from a sample message. |
| `POST /api/orcamento` | Creates a quotation and deal; PDF URL is returned. |
| `GET /api/view?q=<name>` | Public route renders quotation HTML/PDF. |
| `POST /api/send-whatsapp` | Rate-limit bucket allows configured requests per minute. |
| `POST /api/typebot-lead-capture` | Public route still works without auth. |
| `GET /api/whatsapp-flows` | Flow list returns. |
| Build logs | No TypeScript compilation errors; `api/[...path].js` is emitted and bundled. |

Also run the existing Playwright e2e suite pointed at the preview URL.

## 9. Testing and success criteria

- `npm run type-check` passes with zero errors.
- `npm run build:api` emits all expected `api/**/*.js` files.
- `npm run build` succeeds (API build + Vite build).
- `npm run lint` passes for `api/**/*.{js,ts}`.
- Local API server (`scripts/dev-api-server.mjs`) responds correctly to the endpoints above.
- `npm run test:unit` still passes.
- Playwright e2e tests pass against the Vercel preview deployment.
- No change in API response shapes or status codes.
- Business logic (pricing, extraction rules, ERPNext calls) is unchanged.

## 10. Risks and mitigation

| Risk | Mitigation |
|---|---|
| Generated `.js` files are accidentally committed | Add `api/**/*.js` to `.gitignore`; verify in PR diff. |
| Local dev server imports a stale `.js` after a `.ts` edit | Use `npm run dev:api` (watch mode) during backend work. |
| TypeScript strict mode surfaces hidden issues | Fix type errors only; do not refactor logic. If a type is genuinely unknown, use `unknown` + guard, not `any`. |
| `tsc` emit includes source maps that bloat the function bundle | Emit source maps only in dev; set `"sourceMap": false` in `tsconfig.api.json` if bundle size becomes a concern. |
| Puppeteer/Chromium binary path or import breaks after TS emit | Keep the existing import and `@sparticuz/chromium` usage unchanged; test `/api/pdf` in preview. |
| Vercel builder treats `.ts` files as separate functions | Keep `functions` map pointing at the emitted `.js` entrypoint. |

## 11. Non-goals

- Do not migrate `scripts/*.mjs` to TypeScript.
- Do not migrate Playwright tests to TypeScript.
- Do not replace the legacy Lambda shape with Vercel's `req/res` shape.
- Do not add `@vercel/node` as a dependency unless the adapter later needs its helper types.
- Do not introduce Zod, Valibot, or runtime validation.
- Do not change `tailwind.config.js` or the tolerated CommonJS exception there.

## 12. Open questions

1. **Source organization:** Is it acceptable to emit compiled `.js` side-by-side with `.ts` source under `api/`, or do we prefer moving source to `api/src/` and emitting to `api/`? Side-by-side is lower risk for Vercel function paths.
2. **Local dev DX:** Should we adopt `tsx` (or Node 24 native type-stripping with `.ts` imports) for `scripts/dev-api-server.mjs` to avoid the `tsc --watch` step? That would require either changing import extensions to `.ts` or adding a loader dependency.
3. **Source maps in production:** Should `tsconfig.api.json` emit source maps for production, or only for local development?
4. **Migration batch size:** Should we migrate all 49 files in one PR, or split into two PRs (shared libs first, handlers second) to keep reviews manageable?
