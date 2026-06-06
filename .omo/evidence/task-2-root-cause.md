# Root Cause Analysis: vercel dev API Not Loading

## Summary
The Vercel dev server fails to serve API functions because `outputDirectory: "public"` and `buildCommand: "npm run build"` in `vercel.json` trigger the `@vercel/static-build` builder, which blocks the `@vercel/node` builder from compiling the API function at `api/[...path].js`.

## Evidence

### From vercel dev --debug output:
```
[debug] Adding build match for "api/[...path]" with "@vercel/node@latest"
[debug] Adding build match for "package.json" with "@vercel/static-build@latest"
[debug] Building @vercel/static-build@latest:package.json
yarn run v1.22.22
$ vite
VITE v6.4.2 ready in 255 ms
```

**Key observations:**
1. Line 36: Function IS detected → `Adding build match for "api/[...path]" with "@vercel/node@latest"`
2. Line 39: Only static-build is built → `Building @vercel/static-build@latest:package.json`
3. NO line for `Building @vercel/node@latest` — Node.js function NEVER compiled
4. No "Ready!" message from Vercel dev server
5. Port 3000 LISTENING but HTTP requests timeout (HTTP 000)
6. Vite dev server on port 5173 works correctly

### Mechanism:
- `outputDirectory: "public"` + `buildCommand` tell Vercel CLI to use `@vercel/static-build`
- `@vercel/static-build` runs `vite` (dev server) as a long-running process
- `@vercel/node` is detected but NEVER invoked because static-build "wins" the builder slot
- Without the API function compiled, Vercel dev server never reaches its "Ready!" state
- HTTP listener binds early but the handler is never installed → timeout

### Fix:
Remove `outputDirectory` and `buildCommand` from `vercel.json`. Add `devCommand: "vite"`. 
These fields are production-only — Vercel auto-detects Vite for `vercel dev` without them.

## Diagnostic Commands Used
```bash
cmd /c "vercel dev --debug --listen 3000"
curl -s -w "\nHTTP:%{http_code}" "http://localhost:3000/" --max-time 10
```
