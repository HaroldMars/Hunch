# Hunch

Social mood and team engagement platform: timeline, Mood Stories, notes, chat, map and a team Work feed, plus an admin dashboard for team leaders, SMEs, managers and developers.

```
hunch/
├── client/      Client app (React + Vite)        app.hunch.ph     · localhost:5173
├── admin/       Admin dashboard (React + Vite)   admin.hunch.ph   · localhost:3000
├── backend/     API + realtime (Node, Express)   api.hunch.ph     · localhost:5000
├── shared/      Code shared by client and admin (icons, auth screens, constants)
├── marketing/   Marketing tools (generated images are kept out of Git)
└── docs/        Deployment and operations
```

## Run locally
Requires Node 22.13 or newer.

```bash
npm install
npm run dev          # backend :5000, client :5173, admin :3000
```

Optional settings: copy `backend/.env.example` to `backend/.env` (and the client/admin examples) and fill in what you need. `.env` files are ignored by Git.

On a brand-new database the server creates one developer account and prints its temporary password once in the terminal. For local demo data run `npm run seed:demo` (disabled in production).

## Deploy
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
