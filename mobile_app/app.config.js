const fs = require('fs');
const path = require('path');

/**
 * The @react-native-firebase/app plugin takes NO options object -- it reads
 * `android.googleServicesFile` and `ios.googleServicesFile` straight off the
 * Expo config. Anything passed to the plugin entry is silently ignored, which is
 * why both paths are declared on `expo.android` / `expo.ios` below.
 */
function resolveFirebaseFile(envValue, fallback, label) {
  const relativePath = envValue ?? fallback;
  const absolutePath = path.resolve(__dirname, relativePath);
  return { relativePath, absolutePath, exists: fs.existsSync(absolutePath) };
}

const androidGoogleServices = resolveFirebaseFile(
  process.env.GOOGLE_SERVICES_JSON,
  './google-services.json',
  'google-services.json'
);

const iosGoogleServices = resolveFirebaseFile(
  process.env.GOOGLE_SERVICE_INFO_PLIST,
  './GoogleService-Info.plist',
  'GoogleService-Info.plist'
);

// Android is the primary target, so a missing file must fail the build loudly
// rather than ship an APK with no Firebase app (auth would then throw
// "No Firebase App '[DEFAULT]' has been created" at runtime).
if (!androidGoogleServices.exists) {
  throw new Error(
    `[SAGE] google-services.json not found at ${androidGoogleServices.absolutePath}. ` +
      'Set the GOOGLE_SERVICES_JSON env var to a valid path, or place the file at ./google-services.json.'
  );
}

// iOS is optional for now: app.config.js is evaluated for every platform, so
// throwing here would break Android builds too. Warn instead -- the Firebase
// plugin still fails the iOS build with its own "GoogleService-Info.plist doesn't
// exist" error, but this message explains what to do about it.
if (!iosGoogleServices.exists) {
  console.warn(
    `[SAGE] GoogleService-Info.plist not found at ${iosGoogleServices.absolutePath}. ` +
      'Android builds are unaffected, but iOS builds will fail. Download the plist from the Firebase ' +
      'console and either place it at ./GoogleService-Info.plist or point GOOGLE_SERVICE_INFO_PLIST at it.'
  );
}

module.exports = {
  expo: {
    name: "SAGE Learning",
    slug: "SAGE-Learning",
    version: "1.0.0",
    // OTA updates are keyed to the native app version, so an update published
    // for 1.0.0 only ever reaches the build whose version is 1.0.0. This pairs
    // with `appVersionSource: "remote"` + `autoIncrement` in eas.json, which
    // gives every build a unique version (and therefore a unique runtime).
    runtimeVersion: { policy: "appVersion" },
    updates: {
      // EAS Update server for this project. Set explicitly rather than relying on
      // inference from extra.eas.projectId so `eas update` works predictably.
      url: "https://u.expo.dev/215db58a-f74b-44a9-91cb-4b34cbcc2fcf"
    },
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "sage-learning",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    primaryColor: "#7C3AED",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.sage.learning",
      googleServicesFile: iosGoogleServices.relativePath,
      infoPlist: {
        NSLocalNetworkUsageDescription: "SAGE Learning uses your local network so nearby phones can join offline multiplayer games."
      }
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#7C3AED",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png"
      },
      edgeToEdgeEnabled: true,
      // 'resize' is the default and is wrong next to edge-to-edge: edge-to-edge
      // calls WindowCompat.setDecorFitsSystemWindows(window, false), which stops
      // Android resizing the window for the keyboard, so adjustResize silently
      // does nothing. 'pan' makes Android match iOS -- the keyboard floats over
      // the content and KeyboardSafeView owns the offset. Without this the
      // window resize and the view's own padding fight each other and the
      // layout jumps twice on every focus.
      softwareKeyboardLayoutMode: 'pan',
      predictiveBackGestureEnabled: false,
      package: "com.sage.learning",
      googleServicesFile: androidGoogleServices.relativePath
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-router",
      "expo-dev-client",
      "expo-document-picker",
      "expo-sharing",
      "@react-native-community/datetimepicker",
      [
        "expo-image-picker",
        {
          "photosPermission": "SAGE Learning lets you attach photos to study group chats.",
          "cameraPermission": "SAGE Learning uses the camera so you can attach photos to study group chats."
        }
      ],
      [
        "expo-media-library",
        {
          "photosPermission": "SAGE Learning lets you save images you download in chats to your photo library.",
          "savePhotosPermission": "SAGE Learning lets you save images you download in chats to your photo library."
        }
      ],
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#7C3AED",
          "dark": {
            "backgroundColor": "#1E1B4B"
          }
        }
      ],
      "@react-native-firebase/app",
      "@react-native-firebase/auth",
      "expo-sqlite"
    ],
    "experiments": {
      "typedRoutes": true,
      "reactCompiler": true
    },
    "extra": {
      "eas": {
        "projectId": "215db58a-f74b-44a9-91cb-4b34cbcc2fcf"
      }
    }
  }
};