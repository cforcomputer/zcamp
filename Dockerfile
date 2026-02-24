# ──────────────────────────────────────────────────────────────────────────────
# Dockerfile — zKill Activity Tracker (wrighttech/zcamp:latest)
# ──────────────────────────────────────────────────────────────────────────────
# Multi-stage build:
#   Stage 1 (frontend): Node 22 — npm install + vite build → /app/dist
#   Stage 2 (runtime):  Python 3.12 — FastAPI serves API + static frontend
# ──────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: Build React frontend ──────────────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /app

# Install deps first (cached layer)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

# Copy frontend source and build
COPY frontend/ .
RUN npm run build

# ─── Stage 2: Python runtime ────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies (cached layer)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/server.py .
COPY backend/activity_manager.py .
COPY backend/constants.py .

# Copy built frontend from stage 1
# server.py serves this via StaticFiles(directory="frontend/dist", html=True)
COPY --from=frontend-build /app/dist ./frontend/dist

# Default port — matches the old Node.js image
EXPOSE 8080

# Run with uvicorn
# PORT can be overridden via environment variable
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --log-level info"]
