# Firebase Authentication (Google Sign-In) — Setup

This project can use Firebase Authentication (Google) for member and staff sign-in. These instructions will walk you through the minimal steps to enable Google sign-in and accept ID tokens in the API.

## 1) Enable Google provider in Firebase Console
- Visit https://console.firebase.google.com -> your project -> Authentication -> Sign-in method
- Enable 'Google' and optionally add Project support email. Save.

## 2) Set Firebase client config (frontend)
Add these environment variables to your build environment (Vercel / Render / GitHub Actions / local .env):

- VITE_FIREBASE_API_KEY
- VITE_FIREBASE_AUTH_DOMAIN
- VITE_FIREBASE_PROJECT_ID
- VITE_FIREBASE_APP_ID
- VITE_FIREBASE_STORAGE_BUCKET (optional)

These are found in your Firebase console under Project Settings -> General ("Your apps").

## 3) Set admin or staff claims for specific accounts (optional but recommended)
To restrict backend /admin routes to staff, set a custom claim for specific users using Firebase Admin SDK (server-side) or the Firebase CLI / Admin scripts.

Example script (Node):
```js
import admin from 'firebase-admin';
// ensure your GOOGLE_APPLICATION_CREDENTIALS env is set to a service account JSON
admin.initializeApp({ credential: admin.credential.applicationDefault() });

async function setRole(email, role = 'staff'){
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { role });
  console.log('Set role', role, 'for', user.email);
}

setRole('frontdesk@example.com', 'staff').catch(err => console.error(err));
```

## 8) Alternatively: Use Firestore `users` collection + bcrypt (self-managed)
If you prefer to manage credentials directly in Firestore (the `users` collection), use hashed passwords rather than plaintext. A helper script `scripts/firestore-create-user.js` is included to create or update Firestore user docs with bcrypt hashed passwords.

To create a Firestore user with a hashed password (local dev or production), run:
```bash
# set your Google Cloud service account or JSON env first
export GOOGLE_APPLICATION_CREDENTIALS=./path/to/service-account.json
node scripts/firestore-create-user.js frontdesk Kusgan2025! staff
```

The script writes a document in `users` collection with fields: `username`, `password_hash`, `role`, `created_at`.

Your serverless `api/auth/login.js` has been updated to support Firestore user lookups and bcrypt comparison when the server has access to the Firebase Admin SDK (i.e. `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS_JSON` set as env). If Firestore user matches, it will return a simple session token and user object.

Note: Do not store plaintext passwords anywhere. Only hashed password strings (bcrypt) are safe to store in Firestore.

## 4) Client: sign-in with Google
- The frontend login page uses Firebase `signInWithPopup()` and stores the `idToken` in localStorage as `authToken`.
- After sign-in, all requests include `Authorization: Bearer <idToken>` which the backend will validate.

## 5) Server: Accept Firebase ID tokens
- The backend supports both legacy JWT and Firebase ID tokens. The middleware tries to verify a local JWT and, if that fails, will try the Firebase Admin `verifyIdToken` method.
- If Firebase token is valid, the payload is stored in `req.user` with keys: username (email or uid), uid, and role (if custom claim or admin flag present).

## 6) Update /auth/me
- The /auth/me endpoint returns `ok: true` and a user object based on either the server JWT or Firebase token payload.

## 7) Deploy
- Frontend: ensure the VITE_FIREBASE_* variables are set for the hosting environment and deploy. For GitHub Pages, configure the workflow to set `VITE_FIREBASE_API_KEY` and other vars during build then publish static files.
- Backend: ensure the service account JSON is configured and `GOOGLE_APPLICATION_CREDENTIALS` set (or set credentials in the hosting provider). Add `FRONTDESK_PASSWORD` if you still want a fallback.
  - Vercel (UI): Project -> Settings -> Environment Variables. Choose `All Environments` (or `Production`) in the "Environments" dropdown to set a value for production. Paste the JSON into `GOOGLE_APPLICATION_CREDENTIALS_JSON` (or base64 encode it and use `GOOGLE_APPLICATION_CREDENTIALS_JSON_B64` if the UI mangles line breaks). Save and redeploy.
    - Step-by-step (Vercel UI):
      1. Go to https://vercel.com and select your project.
      2. Click "Settings" -> "Environment Variables".
      3. Click the "Add" button, set Key to `GOOGLE_APPLICATION_CREDENTIALS_JSON`.
      4. For Value, paste the entire service account JSON. If you have trouble with line breaks, use the `GOOGLE_APPLICATION_CREDENTIALS_JSON_B64` base64 variant instead.
      5. Select the environment: `Development`, `Preview` or `Production` (or `All Environments`). If you want this to affect the live app, select `Production` or `All Environments`.
      6. Click "Save" and redeploy the project.
      7. After redeploy, check the Vercel logs (Project -> Deployments -> latest -> Logs or Project -> Observability -> Logs) for messages like:
         - "firebase-admin initialized for API server (GOOGLE_APPLICATION_CREDENTIALS_JSON/_B64)"
         - "auth/login env present: {...}"
         - "auth/login: matched Firestore user"
        These confirm the serverless function or API initialized Firebase and saw your env.
  - If you want to programmatically set environment variables, use the included `scripts/vercel-set-env.js`:
```bash
# Example: set GOOGLE_APPLICATION_CREDENTIALS_JSON (value includes JSON)
VERCEL_TOKEN=<your-vercel-token> node scripts/vercel-set-env.js --project <your-project-id> --key GOOGLE_APPLICATION_CREDENTIALS_JSON --value "$(cat my-service-account.json)" --target production

# Example: set a base64 value
VERCEL_TOKEN=<your-vercel-token> node scripts/vercel-set-env.js --project <your-project-id> --key GOOGLE_APPLICATION_CREDENTIALS_JSON_B64 --value "$(base64 my-service-account.json)" --target production
```
  - Note: `VERCEL_TOKEN` can be created at https://vercel.com/account/tokens. You must know your `projectId` or `teamId` if set.

## Notes
- `Firebase custom claims` are the recommended way to mark staff/admin roles so the server can rely on `role` in the ID token.
- If you prefer not to use Firebase on the server side yet, you can leave the `FRONTDESK_PASSWORD` env and use the serverless `auth/login` fallback.

### Quick insecure deployment (for immediate public access)
If you just need the public URL working immediately and you accept the security trade-offs, a temporary default password is baked into `api/auth/login.js` so the frontdesk user can log in without setting any environment variables or service account credentials.

- The default password is `Kusgan2025!` and is hard-coded as a bcrypt hash only as a convenience for immediate deployments.
- This is insecure — anyone with access to the repo or the deployed server may find and reuse it. Only use this to validate UI/UX quickly, and remove it before publishing for a real audience.
- To remove it, delete the `DEFAULT_FRONTDESK_HASH` constant or set `FRONTDESK_PASSWORD` in your hosting environment and redeploy.

Recommended lifecycle for moving from quick to secure:
1. Use the baked-in default only to verify functionality publicly.
2. Set `FRONTDESK_PASSWORD` in production as an env var (Vercel / Render / Railway / Heroku) and reload the site, or create a Firestore user via `scripts/firestore-create-user.js` and enable `GOOGLE_APPLICATION_CREDENTIALS_JSON`.
3. Remove the `DEFAULT_FRONTDESK_HASH` constant and rely only on envs or Firestore.

If you want, I can prepare PRs that implement the frontend login workflow and backend ID token verification (I already added code that does this), and add a Github Actions workflow for Pages & instructions for hosting the server on Render.

## GitHub Pages (this repo)
This repo includes a Pages workflow at `.github/workflows/pages.yml`.

In your GitHub repo settings:
- **Settings → Pages → Source**: select `Deploy from a branch`
- **Branch**: `gh-pages` / `(root)`
- **Settings → Secrets and variables → Actions → Secrets**: add
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_APP_ID`
  - Optional: `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_GOOGLE_CLIENT_ID`

### Frontdesk login on GitHub Pages
GitHub Pages is static hosting, so the frontend cannot safely validate a password against a Firestore `users` collection without a backend.

For Pages deployments, use **Firebase Authentication (Email/Password)** for the frontdesk account:
- Firebase Console → Authentication → Sign-in method → enable **Email/Password**
- Create a user like `frontdesk@yourdomain.com` (or any email you choose)
- Sign in using that email/password in the app

If you want to keep a Firestore `users` collection with bcrypt hashes, you must host a backend (or Cloud Function) that:
- validates username/password server-side
- then signs the client in via Firebase Auth (custom token) or proxies Firestore operations
