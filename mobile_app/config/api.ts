import Constants from 'expo-constants';

// Derive the dev machine's LAN IP from the Metro/expo dev server host
// so the app keeps working even when the laptop's DHCP IP changes.
function deriveDevHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;
  const hostname = hostUri.split(':')[0];
  if (!hostname) return null;
  return `http://${hostname}:8000/api`;
}

export const API_CONFIG = {
  // For development on same device (web)
  LOCALHOST: 'http://localhost:8000/api',

  // Local machine IP (for devices on same network)
  LOCAL: 'http://192.168.1.7:8000/api',

  // ngrok tunnel URL (for testing multiple devices anywhere)
  TUNNEL: 'https://eloquent-flagpole-resupply.ngrok-free.dev/api',

  DEPLOYED: 'https://sage-bozz.onrender.com/api',
};

// Select which config to use.
// In dev, prefer the Metro-derived URL (auto-adapts to IP changes);
// fall back to LOCAL for release builds or when hostUri is unavailable.
export const API_BASE_URL = deriveDevHost() ?? API_CONFIG.LOCAL;
