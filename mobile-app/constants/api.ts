import Constants from 'expo-constants';
import { Platform } from 'react-native';

const BACKEND_PORT = 8000;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/** LAN IP / hostname Expo uses to serve the JS bundle (e.g. 192.168.1.126:8081). */
function getExpoDevHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.hostUri ??
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost;

  if (!hostUri) return null;
  const host = hostUri.split(':')[0];
  return host || null;
}

/**
 * Backend base URL (no trailing slash).
 *
 * Dev (default): uses the same host as the Expo dev server, so it tracks DHCP IP changes.
 * Override: set EXPO_PUBLIC_API_URL (production, ngrok, custom port, etc.).
 */
export function getApiBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return stripTrailingSlash(override);

  if (__DEV__) {
    const devHost = getExpoDevHost();
    if (devHost && devHost !== 'localhost' && devHost !== '127.0.0.1') {
      return `http://${devHost}:${BACKEND_PORT}`;
    }
    if (Platform.OS === 'android' && !Constants.isDevice) {
      return `http://10.0.2.2:${BACKEND_PORT}`;
    }
    return `http://localhost:${BACKEND_PORT}`;
  }

  return `http://localhost:${BACKEND_PORT}`;
}

export const API_BASE_URL = getApiBaseUrl();
