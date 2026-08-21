#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = resolve(ROOT, 'extensions/whatsapp-context');

function readJson(name) {
  try { return JSON.parse(readFileSync(resolve(EXTENSION, name), 'utf8')); }
  catch { throw new Error(`${name} inválido.`); }
}

function configuredOrigin() {
  const source = readFileSync(resolve(EXTENSION, 'config.js'), 'utf8');
  const match = source.match(/appOrigin:\s*['"](https:\/\/[^'"/]+)['"]/);
  if (!match) throw new Error('config.js deve informar um appOrigin HTTPS sem caminho.');
  return match[1];
}

export function validateWhatsappExtension() {
  const manifest = readJson('manifest.json');
  const origin = configuredOrigin();
  if (manifest.manifest_version !== 3) throw new Error('manifest.json deve usar Manifest V3.');
  if (manifest.permissions?.length) throw new Error('manifest.json não deve pedir permissões extras.');
  if (JSON.stringify(manifest).match(/(api[_-]?key|bearer|password|secret|sk-[a-z0-9])/i)) {
    throw new Error('manifest.json não pode conter credenciais.');
  }
  if (JSON.stringify(manifest.host_permissions || []) !== JSON.stringify([`${origin}/*`])) {
    throw new Error('host_permissions deve limitar-se ao appOrigin configurado.');
  }
  const content = manifest.content_scripts?.[0];
  if (!content || JSON.stringify(content.matches) !== JSON.stringify(['https://web.whatsapp.com/*'])) {
    throw new Error('content_scripts deve limitar-se ao WhatsApp Web.');
  }
  if (!content.js?.includes('provider.js') || !content.js?.includes('content.js')) {
    throw new Error('provider.js e content.js devem ser carregados juntos.');
  }
  if (manifest.background?.service_worker !== 'background.js') throw new Error('service worker inválido.');
  for (const file of ['README.md', 'background.js', 'config.js', 'content.js', 'provider.js', 'styles.css']) {
    if (!existsSync(resolve(EXTENSION, file))) throw new Error(`Arquivo da extensão ausente: ${file}.`);
  }
  return { origin, files: 6, permissions: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = validateWhatsappExtension();
    process.stdout.write(`PASS extensão WhatsApp: ${result.origin}; ${result.files} arquivos; ${result.permissions} permissões.\n`);
  } catch (error) {
    process.stderr.write(`FAIL extensão WhatsApp: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
