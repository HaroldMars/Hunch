# Deploying Hunch

| App | Folder | Production URL | Local URL | Host |
|---|---|---|---|---|
| Client app | `client/` | https://app.hunch.ph | http://localhost:5173 | Vercel project `hunch-client` |
| Admin dashboard | `admin/` | https://admin.hunch.ph | http://localhost:3000 | Vercel project `hunch-admin` |
| Backend API | `backend/` | https://api.hunch.ph | http://localhost:5000 | Persistent Node host (see below) |

The client and admin never talk to each other. Both call the backend API only.

## 1. Client and admin on Vercel
Create two Vercel projects from the GitHub repository:

| Setting | hunch-client | hunch-admin |
|---|---|---|
| Root Directory | `client` | `admin` |
| Framework | Vite | Vite |
| Build / Output | `npm run build` / `dist` | `npm run build` / `dist` |
| "Include files outside Root Directory" | On (needed for `shared/`) | On |
| Domain | app.hunch.ph | admin.hunch.ph |

Environment variables (Project → Settings → Environment Variables), from `client/.env.example` and `admin/.env.example`:
`VITE_API_URL=https://api.hunch.ph`, `VITE_CLIENT_URL=https://app.hunch.ph`, `VITE_ADMIN_URL=https://admin.hunch.ph`.
Every merge to `main` deploys automatically; every pull request gets a preview deployment.

## 2. Backend API: why not Vercel
Vercel runs short-lived serverless functions. The Hunch backend needs things serverless can't provide:
- **Realtime chat, typing, notifications and live trips** use a persistent Socket.io connection.
- **The database** is SQLite on disk, and serverless file systems are wiped between requests.
- **The scheduler** sends daily reports and scheduled emails in the background.

So deploy `backend/` on a host that keeps a process running with a persistent disk, for example **Render**, **Railway** or **Fly.io**, and point `api.hunch.ph` at it. A `backend/Dockerfile` is included (build from the repository root):

```bash
docker build -f backend/Dockerfile -t hunch-api .
docker run -p 5000:5000 -v hunch-data:/data --env-file backend/.env hunch-api
```

Mount a persistent volume at `/data` (or set `DATA_DIR`).

**Railway** (simplest): New Project → Deploy from GitHub repo → pick Hunch. It reads `railway.json` and builds `backend/Dockerfile`. Then add a **Volume** mounted at `/data`, add the variables from `backend/.env.example`, and under Settings → Networking add the custom domain `api.hunch.ph`.

**Render**: New → Blueprint → pick the repo. It reads `render.yaml` (web service + 1 GB disk at `/data`) and asks for each secret. Add `api.hunch.ph` under Settings → Custom Domains.

Do not create a Vercel project for `backend/`. If one exists, delete it. To run the API on Vercel itself, the database must first move to a hosted Postgres (`DATABASE_URL`) and realtime to a hosted service; that's a larger migration.

Backend environment variables: see `backend/.env.example`. Required in production: `JWT_SECRET`, `CLIENT_URL`, `ADMIN_URL` (the server refuses to start without them). Set the Cloudinary variables so all media goes to Cloudinary.

## 3. Security already in place
- **Helmet** security headers, including HSTS so browsers only use HTTPS.
- **CORS**: only `CLIENT_URL`, `ADMIN_URL` (and `EXTRA_ORIGINS`) may call the API in production.
- **Rate limiting**: 600 requests/min per IP overall; sign-in, password and verification endpoints are limited much more tightly.
- **JWT authentication**, **bcrypt** password hashing, and **role checks** on every admin and team route (Developer, Manager, TL, SME, Agent).
- **No credentials in code**: the first developer account comes from `INITIAL_ADMIN_*` variables, or a random password is printed once in the server log.
- **Uploads**: images are type-checked; other files are served as downloads only. With Cloudinary configured, nothing is stored on the server.

## 4. Clean production database
Production starts empty: the database file is never committed (see `.gitignore`), and the demo-data scripts (`npm run seed:demo`, `seed:v3`) refuse to run when `NODE_ENV=production`. On first start the server creates only the first developer account. Everything else (users, teams, posts) is created through the app.

Demo accounts, sample posts, fake moods and the marketing demo content exist only in your local development database.

## 5. Git workflow
`main` is protected: changes go through a pull request, the **CI** check (build + secret scan) must pass, then merge. Name branches `feature/...` or `fix/...`, e.g. `feature/story-system`, `fix/timeline-ui`. Merging to `main` triggers the Vercel deployments.

Never commit `.env` files, API keys, database URLs, JWT secrets, Cloudinary secrets, email passwords or OAuth secrets. They live only in the Vercel / API host settings.

## Production checklist
- [ ] `JWT_SECRET` set to a long random value on the API host
- [ ] `CLIENT_URL`, `ADMIN_URL`, `API_URL` set; DNS for app / admin / api pointing at the right hosts; HTTPS on
- [ ] Cloudinary variables set on the API host
- [ ] `INITIAL_ADMIN_*` set (or read the one-time password from the first server log), then change it
- [ ] Persistent disk mounted for the database, with backups
- [ ] Branch protection on `main` (pull request + CI required)
- [ ] Smoke test each role: Developer, Manager, TL, SME, Agent
