# KidsBookRegistry

A mobile-first web app for tracking children's books — what they own, what they want, and what relatives have claimed to buy as gifts. Built with Vite, React (TypeScript), and Tailwind CSS.

Data is stored in the browser's `localStorage` on each device. There is no backend in this MVP.

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

> **Note:** Your book data lives in the browser on whichever device you use — not on your PC. Testing on your phone creates a separate copy of the data in that phone's browser.

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

### Share links

After deploying, guest wish-list links look like:

```
https://your-domain.com/share/{childId}
```

Copy a share link from the dashboard ("Copy share link" on each child's card).

## Other commands

```bash
npm run lint    # Run ESLint
```

## Features

- **Library** — books a child already owns
- **Wish list** — books they'd like; guests can claim items
- **Barcode scanning** — camera or manual ISBN entry (Open Library API for metadata)
- **Check a book** — scan to see if a title is owned or claimed across all registries
- **Dark mode** — manual toggle, persisted in `localStorage`
