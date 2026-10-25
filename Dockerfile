# --- Stage 1: build the admin website (served by the API at /admin) ---
FROM node:22-slim AS admin
WORKDIR /admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY admin/ ./
RUN npm run build

# --- Stage 2: the API with the AI models ---
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# OpenCV (used by ultralytics) needs these system libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# CPU-only PyTorch (much smaller than the default build)
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY requirements-ml.txt requirements.txt ./
RUN pip install -r requirements-ml.txt -r requirements.txt

COPY app ./app
COPY --from=admin /admin/dist /srv/admin_site

RUN useradd -m appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
