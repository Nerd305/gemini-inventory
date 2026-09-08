# VialTrack Count (Expo)

iPhone app for counting vials in the pharmacy fridges. Same Firestore project and
database as the web app; same count logic (`src/shared/`), so a basket saved here
shows up in the web app's Locations map and dashboard immediately.

What it does:

- **Scan** fridge / shelf / basket QR labels (expo-camera), or **tap** through
  fridge → shelf → basket, or **say it**: hold the mic and speak
  "fridge 2 shelf 3", "basket BPC", "four trays and twenty-two vials", "save".
- **Quick count**: full trays + loose vials with big steppers, Empty / Full shortcuts.
- **Visual AI counter**: photograph the loose tray, Gemini counts it and every vial
  is boxed on the photo so you can verify before accepting.
- **New basket** in place (product search with quick-create, lot, slot) and
  **print labels** on the fly to the pharmacy print server (2 × 1.5 in Epson stock).

## One-time setup

1. **Firebase console → Authentication → Sign-in method → enable Email/Password.**
   Google sign-in cannot run inside Expo Go, so the phone signs in with a password
   attached to your existing Google account (same user id, same role).
2. **Web app → Settings → "Phone app sign-in"** → set a password.
3. **Deploy the Firestore rules** from the repo root if you have not yet
   (`firebase deploy --only firestore:rules`).
4. On your Mac:

   ```bash
   cd mobile
   npm install
   cp .env.example .env      # then paste your Gemini key into EXPO_PUBLIC_GEMINI_API_KEY
   ```

5. Install **Expo Go** from the App Store (it must support Expo SDK 57; keep it updated).

## Run it

```bash
cd mobile
npx expo start            # same Wi-Fi as the iPhone
# or, across networks / if Local Network discovery is blocked:
npx expo start --tunnel
```

Point the iPhone **Camera** app at the QR code in the terminal and open it in Expo Go.
The first launch asks for Local Network access (Expo Go), then Camera and Microphone
(the app). Sign in with your email and the password from step 2.

Voice needs the Gemini key (the clip is transcribed by Gemini), the AI counter needs
it too. Scanning, tapping and manual counts work without it.

## Layout of the code

```
mobile/
  App.tsx                      auth gate → SignInScreen | CountScreen
  metro.config.js              watches the repo root so ../src/shared is importable
  src/firebase.ts              RN auth persistence, Firestore long polling, database id
  src/core.ts                  shared count core bound to this app's Firestore handle
  src/hooks/useCountingSession fridge → shelf → basket state, scan + voice dispatch
  src/components/panels/       FridgePicker, ShelfPicker, ShelfBaskets, QuickCount, NewBasket
  src/components/AiCountModal  photo → Gemini → boxed overlay → accept
  src/components/VoiceBar      push-to-talk (expo-audio → Gemini transcript) + typed commands
  src/lib/ai.ts                Gemini REST calls (count vials, transcribe)
  src/lib/voice.ts             recorder hook (16 kHz mono WAV on iOS)
```

Shared with the web app (do not duplicate): `src/shared/inventoryCore.ts`
(`commitBasketCount`, `createBasket`, lookups, subscriptions), `scanCodes.ts`,
`voiceCommands.ts`, `labelFormats.ts`, `printJobs.ts`.

## Troubleshooting

- **"Component auth has not been registered yet"** — Metro resolved the browser build of
  Firebase. `metro.config.js` disables package exports for that reason; make sure you
  started Expo from `mobile/` so that config is used.
- **Nothing found by Expo Go** — allow Local Network for Expo Go in iOS Settings, or use
  `--tunnel`.
- **"Missing EXPO_PUBLIC_GEMINI_API_KEY"** — create `mobile/.env`, then restart
  `npx expo start` (env vars are read at bundle time).
- **Push-to-talk records nothing** — Microphone permission for Expo Go in iOS Settings.
  The typed field still works, including the keyboard's dictation mic.
- **Wrong-lens / blurry scans** — the app uses the default wide camera; hold the label
  10–20 cm away. QR codes on the 2 × 1.5 in labels scan best in good light.
- **Google sign-in, background sync, a real app icon** need a development build
  (`npx expo run:ios` or EAS Build) instead of Expo Go; the code does not change.
