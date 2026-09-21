# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Showing the live leaderboard on a TV

The educator host-session leaderboard (`app/educator/(tabs)/host-session.tsx`) is driven by Firestore, and there's a dedicated **TV leaderboard web page** that renders the same room live — big text, fullscreen, auto-refreshing — without casting the phone's screen.

**The flow**
1. Host starts an online room (Firestore) as normal. The Host Session screen shows a **"Open on a TV"** link with a Copy button.
2. On the TV you have two easy options:
   - **Cast tab (Chromecast/Android TV):** open the link in Chrome on a laptop, then Cast the tab to the TV. The TV renders the page itself — smooth, no mirror artifacts.
   - **Direct browser:** if the TV has a web browser (Android TV / Chromecast with Google TV), open the link directly.
3. The page (`app/tv/[roomCode].tsx`) polls `GET /api/game/rooms/<code>/leaderboard/` every 2 seconds and shows live standings (ranked students by score; team standings in team mode, host excluded).

**How the link is resolved**
- In dev (`npx expo start --web` / Metro web), the link uses the dev machine's LAN IP and port 8081, so any TV on the same Wi-Fi can open it. The backend must be reachable too (`API_BASE_URL`; dev default is the LAN IP on port 8000).
- In production, the web build is hosted somewhere the TV can reach, and the link points to that host. Override with `EXPO_PUBLIC_WEB_URL`.
- The endpoint is intentionally **unauthenticated read-only** (room code is the access key, same as joining); it only exposes names + live scores for players in that room.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
