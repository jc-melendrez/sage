  // API configuration - update this based on your testing environment
  export const API_CONFIG = {
    // For development on same device (web)
    LOCALHOST: 'http://localhost:8000/api',

    // Local machine IP (for devices on same network)
    LOCAL: 'http://192.168.1.10:8000/api',

    // ngrok tunnel URL (for testing multiple devices anywhere)
    TUNNEL: 'https://eloquent-flagpole-resupply.ngrok-free.dev/api',

    DEPLOYED: 'https://sage-bozz.onrender.com',
  };

  // Select which config to use
  // Change to API_CONFIG.LOCAL or API_CONFIG.LOCALHOST for other environments
  export const API_BASE_URL = API_CONFIG.DEPLOYED;
