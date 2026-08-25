import Constants from 'expo-constants';

// Derive the dev machine's LAN IP from the Metro/expo dev server host
// so the app keeps working even when the laptop's DHCP IP changes.
function deriveDevHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;
  const hostname = hostUri.split(':')[0];
  if (!hostname) return null;
  // adb reverse (USB device) makes hostUri "localhost:8081", but port 8000
  // is NOT tunneled — fall back to the LAN IP so the device doesn't point
  // the Django API at itself.
  if (hostname === 'localhost' || hostname === '127.0.0.1') return null;
  return `http://${hostname}:8000/api`;
}

export const API_CONFIG = {
  // For development on same device (web)
  LOCALHOST: 'http://localhost:8000/api',

  // Local machine IP (for devices on same network)
  LOCAL: 'http://192.168.1.2:8000/api',

  // ngrok tunnel URL (for testing multiple devices anywhere)
  TUNNEL: 'https://eloquent-flagpole-resupply.ngrok-free.dev/api',

  DEPLOYED: 'https://sage-bozz.onrender.com/api',
};

// Select which config to use.
// Priority:
// 1. EXPO_PUBLIC_API_URL env var (forces a specific backend, e.g. Render in dev)
// 2. Metro-derived URL in dev (auto-adapts to IP changes)
// 3. DEPLOYED for release builds or when hostUri is unavailable.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (deriveDevHost() ?? API_CONFIG.DEPLOYED);
