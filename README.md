# Hunch

Social mood and team engagement platform: timeline, Mood Stories, notes, chat, map and a team Work feed, plus an admin dashboard for team leaders, SMEs, managers and developers.

```
hunch/
├── client/      Client app (React + Vite)        app.hunch.ph     · localhost:5173
├── admin/       Admin dashboard (React + Vite)   admin.hunch.ph   · localhost:3000
├── backend/     API + realtime (Node, Express)   api.hunch.ph     · localhost:5050
├── shared/      Code shared by client and admin (icons, auth screens, constants)
├── marketing/   Marketing tools (generated images are kept out of Git)
└── docs/        Deployment and operations
```

## Run locally
Requires Node 22.13 or newer.

```bash
npm install
npm run dev          # backend :5050, client :5173, admin :3000
```

Local testing is fully separate from production:
- `backend/.env` holds **test-only** settings (no production keys). Uploads stay in `backend/uploads`, sessions use a local secret, and no real emails are sent: verification codes and emails are printed in the terminal.
- Even if production keys end up in a local `.env`, Cloudinary and real email stay off unless `NODE_ENV=production` (or `USE_REAL_SERVICES=1` for a deliberate one-off check).
- Production values belong only in the API host's environment settings. `.env` files are ignored by Git.

On a brand-new database the server creates one developer account and prints its temporary password once in the terminal. For local demo data run `npm run seed:demo` (disabled in production).

## Deploy
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
