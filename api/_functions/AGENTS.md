# api/_functions Knowledge Base

Internal serverless handlers used by the Vercel API catch-all route at `api/[...path].js`.

## Structure

```
api/
├── [...path].js       # Vercel API entrypoint for /api/*
├── _lib/              # Vercel request/response adapter helpers
└── _functions/        # Internal quotation, CRM, product, sales, freight handlers
```

## Conventions

- ESM only. Always include explicit `.js` extensions on local imports.
- User-facing error messages are in Brazilian Portuguese.
- Keep raw ERPNext errors out of HTTP responses.
- Shared pricing logic lives in `pricing.js`.
- `view.js` is a GET handler and returns `text/html`.
- Other handler files return structured result objects consumed by `api/[...path].js`.

## Local and Deploy

- Local dev: `vercel dev`
- Production deploy: `vercel deploy --prod`
