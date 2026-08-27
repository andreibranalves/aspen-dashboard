#!/usr/bin/env node

// Status de configuração operacional por operação (fonte normativa: scripts/lib/operation-env.mjs).
//
// Uso:
//   node scripts/cutover-env-status.mjs                 — todas as operações
//   node scripts/cutover-env-status.mjs migration       — uma operação específica
//
// Saída contém somente nomes e estados (present|missing|invalid-permission|
// unreadable|not-needed), nunca valores. Exit 1 quando alguma exigência falha.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatOperationEnvStatus,
  inspectOperationEnv,
  operationNames,
} from './lib/operation-env.mjs';

function isCli() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const requested = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
  let exitCode = 0;

  try {
    const targets = requested.length > 0 ? requested : operationNames();
    for (const operation of targets) {
      let result;
      try {
        result = inspectOperationEnv(operation);
      } catch {
        // Operação desconhecida falha fechada antes de qualquer decisão.
        throw new Error(`Operação desconhecida: ${operation}. Use uma de ${operationNames().join(', ')}.`);
      }
      process.stdout.write(formatOperationEnvStatus(result));
      if (!result.ok) exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }

  if (requested.length === 0 && exitCode !== 0) {
    process.stderr.write('\nAlgumas operações estão sem variáveis obrigatórias; use <operacao> para detalhes.\n');
  }
  if (exitCode !== 0) process.exitCode = exitCode;
}
