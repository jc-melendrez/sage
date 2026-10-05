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
      // 'adjustNothing' means the system never moves or resizes the window: the
      // keyboard purely overlays the content and KeyboardSafeView is the single
      // thing that moves the layout. That is the whole design -- see
      // components/KeyboardSafeView.tsx.
      //
      // This was 'pan', which is the opposite of what it looks like.
      // adjustPan makes Android translate the window up to reveal the focused
      // input, and KeyboardSafeView *also* pads by the full keyboard height.
      // The two compound, so on every focus the content overshot the keyboard
      // and left a blank strip above it.
      //
      // Not 'resize' either: edge-to-edge calls
      // WindowCompat.setDecorFitsSystemWindows(window, false), which stops the
      // resize, so 'resize' is only an implicit 'nothing' -- and it would start
      // double-applying again the moment edge-to-edge is turned off.
      //
      // Expo types this field as 'resize' | 'pan' only, but @expo/config-plugins
      // writes unmapped values through verbatim (`MAPPING[value] ?? value` in
      // android/WindowSoftInputMode.js), so 'adjustNothing' reaches the
      // manifest as-is. That pass-through is undocumented, so it is worth
      // re-checking android/app/src/main/AndroidManifest.xml after a prebuild.
      softwareKeyboardLayoutMode: 'adjustNothing',
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
          // The "Sage" wordmark. Rendered to this file by
          // scripts/generate-splash.py -- re-run that script rather than
          // editing the PNG by hand.
          "image": "./assets/images/splash-icon.png",
          "resizeMode": "contain",
          "backgroundColor": "#7C3AED",
          "dark": {
            "backgroundColor": "#1E1B4B"
          },
          "android": {
            // Smaller than iOS on purpose. Android 12+ masks
            // windowSplashScreenAnimatedIcon into a circle covering the inner
            // 2/3 of its 240dp icon window, so anything wider than ~170dp gets
            // its ends clipped off. 170 keeps the whole wordmark inside that
            // circle with a few dp to spare.
            "imageWidth": 170
          },
          "ios": {
            // No mask on iOS, so the wordmark can use the full 200pt.
            "imageWidth": 200
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