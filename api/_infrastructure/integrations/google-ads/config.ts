export interface GoogleAdsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId: string;
  apiVersion: string;
}

type Environment = typeof process.env;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function getGoogleAdsConfig(env: Environment = process.env): GoogleAdsConfig {
  const customerId = digitsOnly((env.GOOGLE_ADS_CUSTOMER_ID || '').trim());
  const loginCustomerId = digitsOnly((env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').trim()) || customerId;
  const apiVersion = (env.GOOGLE_ADS_API_VERSION || 'v24').trim() || 'v24';
  return {
    clientId: (env.GOOGLE_ADS_CLIENT_ID || '').trim(),
    clientSecret: (env.GOOGLE_ADS_CLIENT_SECRET || '').trim(),
    refreshToken: (env.GOOGLE_ADS_REFRESH_TOKEN || '').trim(),
    developerToken: (env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim(),
    customerId,
    loginCustomerId,
    apiVersion: apiVersion.startsWith('v') ? apiVersion : `v${apiVersion}`,
  };
}

export function isGoogleAdsConfigured(config: GoogleAdsConfig): boolean {
  return Boolean(
    config.clientId &&
      config.clientSecret &&
      config.refreshToken &&
      config.developerToken &&
      config.customerId
  );
}
