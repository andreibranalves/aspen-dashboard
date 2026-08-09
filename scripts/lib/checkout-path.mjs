import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKOUT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function isInside(root, candidate) {
  const relation = relative(root, candidate);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation));
}

async function realpathWithMissingLeaf(pathname) {
  let current = pathname;
  const missing = [];
  while (true) {
    try {
      const existing = await realpath(current);
      return resolve(existing, ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.push(basename(current));
      current = parent;
    }
  }
}

export async function assertOutsideCheckout(pathname, label = 'Arquivo de manifesto de descarte') {
  const lexical = resolve(pathname);
  const checkout = await realpath(CHECKOUT_ROOT);
  if (isInside(checkout, lexical)) throw new Error(`${label} deve ficar fora do checkout.`);
  let actual;
  try {
    actual = await realpathWithMissingLeaf(lexical);
  } catch {
    throw new Error(`${label} não pôde ser validado.`);
  }
  if (isInside(checkout, actual)) throw new Error(`${label} deve ficar fora do checkout.`);
  return lexical;
}
