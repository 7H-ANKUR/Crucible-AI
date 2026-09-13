# 11 — Environment and DevOps
# MINEx — SIH26009 | v1.0

---

## 1. Development Environment

### 1.1 Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.11+ | Backend, ML |
| Node.js | 20 LTS | Frontend |
| Docker Desktop | 24+ | Local infra (Postgres, Redis) |
| uv | Latest | Python package manager |
| pnpm | 9+ | Node package manager |
| Git | 2.40+ | Version control |

### 1.2 First-Time Setup

```bash
# Clone repo
git clone https://github.com/<org>/SIH26009.git
cd SIH26009

# Copy environment file
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET_KEY at minimum

# Install all JS dependencies
pnpm install

# Install all Python dependencies
uv sync --all-packages

# Start infrastructure
docker-compose up -d

# Wait for Postgres to be ready, then run migrations
cd apps/api
alembic upgrade head

# Seed synthetic datasets
cd ../..
python scripts/seed_db.py

# Verify India compliance
python scripts/validate_india.py

# Start dev servers (all services in parallel)
pnpm run dev
```

### 1.3 Service Ports

| Service | Port | URL |
|---------|------|-----|
| Next.js frontend | 3000 | http://localhost:3000 |
| FastAPI backend | 8000 | http://localhost:8000 |
| API docs (Swagger) | 8000 | http://localhost:8000/docs |
| PostgreSQL | 5432 | postgresql://localhost:5432/minex_db |
| Redis | 6379 | redis://localhost:6379 |

---

## 2. `docker-compose.yml`

```yaml
version: '3.9'

services:
  postgres:
    image: postgis/postgis:15-3.4
    environment:
      POSTGRES_DB: minex_db
      POSTGRES_USER: minex
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-minexdev}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U minex -d minex_db"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql+asyncpg://minex:${POSTGRES_PASSWORD:-minexdev}@postgres:5432/minex_db
      REDIS_URL: redis://redis:6379
      JWT_SECRET_KEY: ${JWT_SECRET_KEY:-dev_secret_change_me}
      MODEL_STORE_PATH: /app/ml/models
      SYNTHETIC_SEED: 26009
      ENVIRONMENT: development
    volumes:
      - ./apps/ml/models:/app/ml/models:ro
      - ./data:/app/data:ro
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: uvicorn main:app --host 0.0.0.0 --port 8000 --reload

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://api:8000/api/v1
      NEXTAUTH_URL: http://localhost:3000
      NEXTAUTH_SECRET: ${JWT_SECRET_KEY:-dev_secret_change_me}
    depends_on:
      - api
    command: npm run dev

volumes:
  postgres_data:
  redis_data:
```

---

## 3. `infra/postgres/init.sql`

```sql
-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create schemas
CREATE SCHEMA IF NOT EXISTS geo;
CREATE SCHEMA IF NOT EXISTS ml;
CREATE SCHEMA IF NOT EXISTS gov;
CREATE SCHEMA IF NOT EXISTS ops;

-- Grant
GRANT ALL PRIVILEGES ON DATABASE minex_db TO minex;
GRANT ALL ON ALL TABLES IN SCHEMA public TO minex;
GRANT ALL ON ALL TABLES IN SCHEMA geo TO minex;
GRANT ALL ON ALL TABLES IN SCHEMA ml TO minex;
GRANT ALL ON ALL TABLES IN SCHEMA gov TO minex;
GRANT ALL ON ALL TABLES IN SCHEMA ops TO minex;
```

---

## 4. Dockerfiles

### `apps/api/Dockerfile`
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# System dependencies for geospatial
RUN apt-get update && apt-get install -y \
    libgdal-dev libgeos-dev libproj-dev \
    gcc g++ \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv

# Copy dependency files
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy source
COPY . .

# Run as non-root
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### `apps/web/Dockerfile`
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

---

## 5. Environment Variables Reference

```bash
# === REQUIRED ===

# Database
DATABASE_URL=postgresql+asyncpg://minex:password@localhost:5432/minex_db

# Auth
JWT_SECRET_KEY=<generate with: openssl rand -hex 32>
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# === OPTIONAL (have defaults) ===

# API server
API_HOST=0.0.0.0
API_PORT=8000
CORS_ORIGINS=http://localhost:3000
ENVIRONMENT=development                   # 'development' | 'production'

# Redis
REDIS_URL=redis://localhost:6379

# ML
MODEL_STORE_PATH=apps/ml/models
RANDOM_SEED=26009
SYNTHETIC_SEED=26009

# Storage
STORAGE_BACKEND=local                     # 'local' | 's3'
STORAGE_PATH=./storage

# Demo mode
DEMO_FIXTURES=false                       # 'true' → serve pre-computed fixtures

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<same as JWT_SECRET_KEY>

# === NEVER COMMIT ===
# DATABASE_URL with real credentials
# JWT_SECRET_KEY
# Any MOIL or GSI API keys
```

---

## 6. CI/CD Pipeline

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]

jobs:
  lint-and-type-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g pnpm && pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run type-check

  python-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install uv && uv sync --all-packages
      - run: uv run ruff check apps/api apps/ml packages/py-core
      - run: uv run mypy apps/api --ignore-missing-imports

  api-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:15-3.4
        env:
          POSTGRES_DB: minex_test
          POSTGRES_USER: minex
          POSTGRES_PASSWORD: testpass
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install uv && uv sync --all-packages
      - env:
          DATABASE_URL: postgresql+asyncpg://minex:testpass@localhost:5432/minex_test
          JWT_SECRET_KEY: test_secret_key_ci
          ENVIRONMENT: test
        run: |
          uv run alembic upgrade head
          uv run pytest apps/api/tests/ -v --tb=short

  india-compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install uv && uv sync --all-packages
      - run: uv run python scripts/validate_india.py --fail-on-violation

  leakage-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install uv && uv sync --all-packages
      - run: uv run python scripts/check_leakage.py --fail-on-leakage
```

### `.github/workflows/ml-validation.yml`

```yaml
name: ML Validation

on:
  push:
    paths:
      - 'apps/ml/**'
      - 'data/**'

jobs:
  validate-models:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install uv && uv sync --all-packages
      - run: uv run python apps/ml/evaluation/validation_report.py
      - run: |
          # Fail if any model has leakage_status != PASS
          python -c "
          import csv
          with open('apps/ml/FINAL_MODEL_VALIDATION.csv') as f:
              for row in csv.DictReader(f):
                  assert row['leakage_status'] == 'PASS', \
                    f'Leakage detected in {row[\"task\"]}/{row[\"model\"]}'
          print('All leakage checks pass')
          "
      - uses: actions/upload-artifact@v4
        with:
          name: validation-report
          path: apps/ml/FINAL_MODEL_VALIDATION.csv
```

---

## 7. Python Tooling

### `pyproject.toml` (root)
```toml
[tool.ruff]
line-length = 100
select = ["E", "F", "I", "N", "W", "UP"]
ignore = ["E501"]

[tool.mypy]
python_version = "3.11"
strict = false
ignore_missing_imports = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["apps/api/tests", "packages/py-core/tests"]
```

### `uv` workspace configuration
```toml
[tool.uv.workspace]
members = ["apps/api", "apps/ml", "packages/py-core"]
```

---

## 8. Node Tooling

### `package.json` (root)
```json
{
  "name": "minex-monorepo",
  "private": true,
  "workspaces": ["apps/web", "packages/ui", "packages/types"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "type-check": "turbo type-check",
    "test": "turbo test"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

## 9. Secret Management Rules

| Secret | Storage |
|--------|---------|
| `JWT_SECRET_KEY` | `.env` (never in Git) |
| `DATABASE_URL` with password | `.env` (never in Git) |
| `REDIS_URL` (Upstash TLS `rediss://`) | `.env` (never in Git) |
| MOIL/GSI API keys (future) | `.env` + secrets manager |
| Synthetic dataset contents | Git-safe (labelled SYNTHETIC) |
| Model artifacts | Local `apps/ml/models/` (not committed; generated on setup) |

### 9.1 Redis & Upstash Configuration
| Variable | Default | Purpose |
|----------|---------|---------|
| `REDIS_ENABLED` | `true` | Enables/disables L2 caching |
| `REDIS_URL` | `None` | Upstash Redis connection string (`rediss://...` for TLS) |
| `REDIS_TTL_DEFAULT` | `60` | Default L2 TTL in seconds |
| `REDIS_L1_TTL_DEFAULT`| `10` | Default L1 in-memory micro-cache TTL in seconds |
| `REDIS_L1_MAX_ENTRIES`| `1000` | LRU capacity ceiling for process-local memory |
| `REDIS_MAX_CONNECTIONS`| `10` | Redis client pool connection ceiling |
| `REDIS_CONNECT_TIMEOUT`| `1.0` | Socket connect timeout in seconds |
| `REDIS_SOCKET_TIMEOUT`| `1.5` | Socket read/write timeout in seconds |
| `REDIS_CIRCUIT_BREAKER_SECONDS` | `30` | Fast-fail cooldown period when Redis is unreachable |
| `REDIS_COMPRESSION_THRESHOLD_BYTES`| `25600` | Payloads > 25KB are transparently compressed with `zlib` |

`.gitignore` must include:
```
.env
*.env.local
apps/ml/models/*.joblib
apps/ml/models/*.pkl
storage/
__pycache__/
.next/
```

---

## 10. Demo Environment Setup

For demo day, run on a **local laptop** (not remote cloud) to avoid network dependency:

```bash
# Full demo reset
docker-compose down -v
docker-compose up -d
alembic upgrade head
python scripts/seed_db.py
python apps/ml/pipelines/production_pipeline.py
python apps/ml/pipelines/prospectivity_pipeline.py
python apps/ml/pipelines/shortfall_pipeline.py
python apps/ml/pipelines/equipment_pipeline.py

# Enable fixture fallback (safety net)
DEMO_FIXTURES=true pnpm run start

# Verify all endpoints
python scripts/demo_healthcheck.py   # hits all P1 endpoints, logs response times
```

`scripts/demo_healthcheck.py` should verify every P1 endpoint returns 200 and response time < 3s before demo begins.
