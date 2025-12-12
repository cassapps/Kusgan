# Kusgan Fitness Gym — Frontend

React + Vite front-end dashboard (no backend yet).

## Run locally
```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build
```bash
npm run build
```

## Deploy to GitHub Pages

This repo builds via GitHub Actions and publishes the static build to the `gh-pages` branch.

1) GitHub repo → **Settings → Pages**
- **Source**: `Deploy from a branch`
- **Branch**: `gh-pages` / `(root)`

2) GitHub repo → **Settings → Secrets and variables → Actions → Secrets**
Add these (required for Firestore mode):
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Optional:
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_GOOGLE_CLIENT_ID`

3) Push to `main` (or run the workflow manually)

Notes:
- The workflow sets `VITE_BASE=/Kusgan/` so assets resolve correctly on Pages.
- On GitHub Pages (static hosting), staff sign-in should use **Firebase Auth Email/Password** (e.g. a frontdesk email). Using a Firestore `users` collection for password auth requires a backend.
