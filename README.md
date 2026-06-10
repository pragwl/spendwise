# SpendWise

A fullstack personal expense tracker with budgets, categories, payment sources, and analytics.

**Stack:** React + TypeScript (frontend) · Node.js + Express + TypeScript (backend) · Prisma ORM · PostgreSQL (Neon)

---

## Project Structure

```
spendwise/
├── frontend/          # React + Vite app
│   ├── src/
│   │   ├── App.tsx            # All screens and UI
│   │   ├── context/
│   │   │   └── DataContext.tsx  # Shared state, all API calls
│   │   ├── api/               # Axios API clients
│   │   ├── hooks/             # Legacy hooks (kept for reference)
│   │   └── types/index.ts     # Shared TypeScript types
│   └── package.json
├── backend/           # Express API server
│   ├── src/
│   │   ├── server.ts          # Entry point, middleware, static serving
│   │   ├── controllers/       # Route handlers
│   │   ├── routes/            # Express routers
│   │   ├── middleware/        # Error handler, logger, validator
│   │   └── utils/             # Response helpers, error classes
│   ├── prisma/
│   │   ├── schema.prisma      # Database models
│   │   └── seed.ts            # Seed data
│   └── package.json
└── package.json       # Root — npm workspaces + shared scripts
```

---

## Local Setup

### Prerequisites

- Node.js 18+
- A PostgreSQL database — free options: [Neon](https://neon.tech), [Supabase](https://supabase.com)

### 1. Clone the repo

```bash
git clone https://github.com/pragwl/spendwise.git
cd spendwise
```

### 2. Install dependencies

```bash
npm install
```

This installs packages for the root, `frontend/`, and `backend/` workspaces in one shot.

### 3. Configure environment variables

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in your values:

```env
# Your PostgreSQL connection string (Neon, Supabase, or local)
DATABASE_URL="postgresql://user:password@host:5432/dbname?schema=public"

PORT=4000
NODE_ENV=development

# Allowed CORS origins (comma-separated)
ALLOWED_ORIGINS=http://localhost:5173

# Rate limiting (high values for local dev)
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=10000

LOG_LEVEL=dev
```

### 4. Push the schema and seed the database

```bash
# Push schema to your database (creates all tables)
npm run db:push

# Optional: seed with sample categories, budgets, and expenses
npm run db:seed
```

### 5. Start the development servers

```bash
npm run dev
```

This runs both servers concurrently:

| Server   | URL                       |
|----------|---------------------------|
| Frontend | http://localhost:5173     |
| Backend  | http://localhost:4000     |
| API base | http://localhost:4000/api/v1 |

The frontend proxies nothing — it calls the backend directly at `http://localhost:4000/api/v1` (configured in `frontend/src/config.ts`).

---

## Available Scripts

Run these from the **root** of the repo:

| Command | Description |
|---|---|
| `npm run dev` | Start both frontend (Vite) and backend (ts-node-dev) |
| `npm run build` | Production build — frontend then backend |
| `npm run start` | Start the compiled production server |
| `npm run db:push` | Sync Prisma schema to the database |
| `npm run db:migrate` | Run pending Prisma migrations (production) |
| `npm run db:seed` | Seed the database with sample data |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |

---

## How the Build Works

### Development

```
npm run dev
  ├── backend:  ts-node-dev src/server.ts   → hot-reloads TypeScript directly, no compile step
  └── frontend: vite                         → HMR dev server on port 5173
```

Both processes run in parallel via `concurrently`. The frontend talks to the backend on port 4000.

### Production

```
npm run build
  ├── 1. frontend: tsc && vite build
  │       └── outputs → frontend/dist/  (static HTML + JS + CSS)
  └── 2. backend:  prisma generate && tsc
          ├── prisma generate → regenerates @prisma/client query engine
          └── tsc             → compiles TypeScript → backend/dist/
```

Frontend must build **before** the backend so that `frontend/dist/` exists when the backend is compiled (the backend's `server.ts` references that path at startup).

### How the single server works in production

```
Node.js (backend/dist/server.js)
  ├── /api/v1/*   → Express routes → Prisma → PostgreSQL
  └── /*          → express.static(frontend/dist) → serves React SPA
                    └── all unmatched routes → index.html (client-side routing)
```

The compiled backend detects whether `frontend/dist/` exists. If it does, it serves the static files and falls back to `index.html` for any non-API route. In local dev the `dist/` folder doesn't exist (Vite serves the frontend separately), so this branch is never hit.

---

## Deployment (Render)

The app deploys as a single **Web Service** on [Render](https://render.com).

| Setting | Value |
|---|---|
| Build Command | `npm install && npm run build` |
| Start Command | `npm run start` |
| Instance Type | Free |

**Required environment variables on Render:**

| Key | Value |
|---|---|
| `DATABASE_URL` | Your Neon/Supabase connection string |
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `ALLOWED_ORIGINS` | Your Render app URL e.g. `https://spendwise.onrender.com` |
| `RATE_LIMIT_MAX` | `500` |

> **Note:** The free tier on Render sleeps after 15 minutes of inactivity. The first request after sleeping takes ~30 seconds.

---

## API Reference

Base URL: `/api/v1`

| Resource | Endpoints |
|---|---|
| Categories | `GET /categories` · `POST /categories` · `PUT /categories/:id` · `DELETE /categories/:id` |
| Payment Sources | `GET /sources` · `POST /sources` · `PUT /sources/:id` · `DELETE /sources/:id` |
| Budgets | `GET /budgets` · `POST /budgets` · `PUT /budgets/:id` · `DELETE /budgets/:id` |
| Expenses | `GET /expenses` · `POST /expenses` · `PUT /expenses/:id` · `DELETE /expenses/:id` |
| Analytics | `GET /analytics/summary` · `GET /analytics/monthly-trend` |
| Health | `GET /health` |
