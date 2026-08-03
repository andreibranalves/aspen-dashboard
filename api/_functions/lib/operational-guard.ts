/**
 * Reusable guard wrapper for Frappe-dependent handlers.
 *
 * When operational mode is active the wrapped handler is never invoked;
 * instead a 503 with a Portuguese message is returned immediately.
 */
import { isOperationalMode } from '../operational-mode.js';
import type { LegacyHandler, FunctionEvent, FunctionResult } from '../../_lib/types.js';

export function gateOperational(handler: LegacyHandler, endpointName: string): LegacyHandler {
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (isOperationalMode()) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: `${endpointName} não está disponível no modo operacional.`,
        }),
      };
    }
    return handler(event);
  };
}
