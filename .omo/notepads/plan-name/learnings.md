
## 2026-06-05: vercel.json fix for API functions
- devCommand: 'vite' prevents @vercel/node from importing/compiling - API requests timeout
- uildCommand: '' (empty string) + outputDirectory: 'public' works: @vercel/node compiles API functions, @vercel/static serves frontend files
- Empty buildCommand prevents @vercel/static-build from triggering (which always 'wins' over @vercel/node and blocks it)
- With the working config, both API (port 50372 Node.js dev server) and frontend (static files from public/) work correctly
- NOTE: The originally prescribed fix (remove buildCommand/outputDirectory, add devCommand) does NOT work in Vercel CLI 50.25.4
