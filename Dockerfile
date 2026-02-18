# Dockerfile.backend
# Python backend for the zKill Activity Tracker
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY server.py .
COPY activity_manager.py .

EXPOSE 8080

# Run with uvicorn; --reload for dev (mount volumes), remove for prod
# PORT is read from .env via docker-compose env_file
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --reload"]