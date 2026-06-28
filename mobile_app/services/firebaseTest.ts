import { getApps, getApp } from '@react-native-firebase/app';

export function testFirebase() {
  console.log("===== FIREBASE TEST =====");

  console.log("Apps:", getApps().length);

  try {
    const app = getApp();

    console.log("Project ID:", app.options.projectId);
    console.log("App ID:", app.options.appId);
    console.log("Storage:", app.options.storageBucket);
  } catch (e) {
    console.error("getApp() failed:", e);
  }

  console.log("=========================");
}