const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
const googleServiceInfoPlist = process.env.GOOGLE_SERVICE_INFO_PLIST ?? './GoogleService-Info.plist';

module.exports = {
  expo: {
    name: "SAGE Learning",
    slug: "SAGE-Learning",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "sage-learning",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    primaryColor: "#7C3AED",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.sage.learning",
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
      googleServicesFile
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
      [
        "@react-native-firebase/app",
        {
          "android": {
            "googleServicesFile": googleServicesFile
          },
          "ios": {
            "googleServiceInfoPlist": googleServiceInfoPlist
          }
        }
      ],
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