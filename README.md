# KidsBookRegistry

A mobile-first web app for tracking children's books — what they own, what they want, and what relatives have claimed to buy as gifts. Built with Vite, React (TypeScript), and Tailwind CSS.

Your registry is stored as **one encrypted file** (`registry.kbr`) in cloud storage (Google Drive) or in local IndexedDB for development. The app encrypts everything with a passphrase you choose; optional "remember on this device" stores a wrapped key locally so you do not have to re-enter it every visit.

There is no custom backend for registry data — the browser talks to Google Drive directly. A small **server-side token endpoint** (`/api/google/token`) exchanges the OAuth code using your client secret so it never ships to the browser.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later (includes `npm`)

## Local development

```bash
# Install dependencies (first time only)
npm install

# Start the dev server
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

### First launch

1. Choose **Connect Google Drive** (if configured) or **Use local storage (dev)**.
2. Create a passphrase (or unlock an existing registry).
3. Add your email and children from the dashboard.

### Google Drive setup (optional)

1. Copy `.env.example` to `.env`.
2. Create an OAuth 2.0 **Web application** client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
3. Add an authorized redirect URI: `http://localhost:5173/oauth/callback` (and your production URL when deployed).
4. Set in `.env`:
   - `VITE_GOOGLE_CLIENT_ID` — Client ID (public, baked into the app build)
   - `GOOGLE_CLIENT_SECRET` — Client secret from the **same** OAuth client (server only, **no** `VITE_` prefix)
5. Restart the dev server.

Google Web OAuth clients require the client secret at token exchange time. The Vite dev server handles this at `/api/google/token`; on Netlify, `netlify/functions/google-token.ts` does the same.

Without a client ID, the app falls back to local storage only.

### Testing on your phone (same Wi‑Fi)

The barcode scanner needs a secure context (HTTPS) on mobile. For local development, use [ngrok](https://ngrok.com/) to tunnel your dev server over HTTPS.

**1. Start Vite with network access**

```bash
npm run dev -- --host
```

**2. Install and configure ngrok** (first time only)

```bash
# Install (Windows)
winget install ngrok.ngrok

# Add your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
ngrok config add-authtoken YOUR_TOKEN_HERE
```

**3. Start the tunnel**

In a second terminal, while the dev server is running:

```bash
ngrok http 5173
```

**4. Open the ngrok URL on your phone**

Use the `https://…ngrok-free.dev` URL ngrok prints. Vite is already configured to allow ngrok hosts (`server.allowedHosts: true` in `vite.config.ts`).

When using Google Drive, your registry syncs across devices. With **local storage (dev)**, data stays in that browser only.

## Production build

```bash
npm run build
```

This compiles TypeScript and outputs a static site to `dist/`.

Preview the production build locally:

```bash
npm run preview
```

## Deploy

The built app is a static site — deploy the contents of `dist/` to any static host.

| Platform | Approach |
|----------|----------|
| **Netlify / Vercel / Cloudflare Pages** | Connect the repo or drag-and-drop `dist/` |
| **GitHub Pages** | Upload `dist/` or use a GitHub Action |
| **Any web server** | Copy `dist/` to the server and serve it |

Because the app uses client-side routing (`react-router-dom`), configure your host to serve `index.html` for all routes (SPA fallback). Most static hosts do this automatically.

### Environment variables for production

On **Netlify** (see `netlify.toml`), set:

| Variable | Where |
|----------|--------|
| `VITE_GOOGLE_CLIENT_ID` | Build environment (public) |
| `GOOGLE_CLIENT_SECRET` | Functions/runtime only (never `VITE_`) |

Add your production domain to OAuth redirect URIs:

```
https://your-domain.com/oauth/callback
```

Other static hosts need their own serverless function equivalent of `netlify/functions/google-token.ts`, or deploy on Netlify for Google Drive support out of the box.

### Share links

After deploying, guest wish-list links look like:

```
https://your-domain.com/share/{childId}?f={driveFileId}#{shareKey}
```

Copy a share link from the dashboard ("Copy share link" on each child's card). The app syncs to cloud first, then copies the link.

- **`#shareKey`** — decrypts the public wish-list slice for guests (never sent to a server).
- **`?f=`** — points to the encrypted registry file in Google Drive.

For **local dev storage**, links use `?f=local` and only work in the same browser (for testing the guest flow).

### Guest claims

Guests can claim books from the shared wish list. Claims are appended to the encrypted registry file. If anonymous writes to Google Drive fail, the owner can tap **Sync claims** in the app banner to merge guest claims on next open.

## Other commands

```bash
npm run lint    # Run ESLint
```

## Features

- **Library** — books a child already owns
- **Wish list** — books they'd like; guests can claim items
- **Encrypted cloud sync** — one passphrase-protected registry file with local cache and backup rotation
- **Google Drive** — OAuth PKCE; data stays in your Drive under `KidsBookRegistry/`
- **Barcode scanning** — camera or manual ISBN entry (Open Library API for metadata)
- **Check a book** — scan to see if a title is owned or claimed across all registries
- **Dark mode** — manual toggle, persisted in `localStorage`
