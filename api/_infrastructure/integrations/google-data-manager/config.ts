import { GOOGLE_DATA_MANAGER_SCOPE, type OfflineDestination } from '../../../_modules/ads-offline-core.js';

export interface GoogleDataManagerConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  operatingAccountId: string;
  productDestinationId: string;
  productDestinationType: string;
  apiVersion: string;
  oauthScope: string;
}

type Environment = typeof process.env;

function clean(value: unknown): string {
  return String(value || '').trim();
}

export function getGoogleDataManagerConfig(env: Environment = process.env): GoogleDataManagerConfig {
  const apiVersion = clean(env.GOOGLE_DATA_MANAGER_API_VERSION || 'v1');
  return {
    clientId: clean(env.GOOGLE_DATA_MANAGER_CLIENT_ID),
    clientSecret: clean(env.GOOGLE_DATA_MANAGER_CLIENT_SECRET),
    refreshToken: clean(env.GOOGLE_DATA_MANAGER_REFRESH_TOKEN),
    operatingAccountId: clean(env.GOOGLE_DATA_MANAGER_OPERATING_ACCOUNT_ID),
    productDestinationId: clean(env.GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_ID),
    productDestinationType: clean(env.GOOGLE_DATA_MANAGER_PRODUCT_DESTINATION_TYPE || 'UPLOAD_CLICKS'),
    apiVersion: apiVersion.startsWith('v') ? apiVersion : `v${apiVersion}`,
    oauthScope: GOOGLE_DATA_MANAGER_SCOPE,
  };
}

export function isGoogleDataManagerConfigured(config: GoogleDataManagerConfig): boolean {
  return Boolean(
    config.clientId &&
      config.clientSecret &&
      config.refreshToken &&
      /^\d+$/.test(config.operatingAccountId) &&
      /^\d+$/.test(config.productDestinationId) &&
      config.productDestinationType === 'UPLOAD_CLICKS' &&
      config.oauthScope === GOOGLE_DATA_MANAGER_SCOPE
  );
}

export function destinationFromGoogleDataManagerConfig(
  config: GoogleDataManagerConfig
): OfflineDestination {
  return {
    operatingAccountId: config.operatingAccountId,
    productDestinationId: config.productDestinationId,
    productDestinationType: config.productDestinationType,
  };
}

