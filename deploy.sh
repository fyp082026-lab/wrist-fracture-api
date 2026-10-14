#!/usr/bin/env bash
# Runs ON THE SERVER. Usage: ./deploy.sh ghcr.io/owner/repo:abc1234
set -euo pipefail

NEW_IMAGE="${1:?usage: deploy.sh <image>}"
cd "$HOME/app"

PREV_IMAGE=""
[ -f .last_image ] && PREV_IMAGE="$(cat .last_image)"

echo ">> Pulling $NEW_IMAGE"
docker pull "$NEW_IMAGE"

echo ">> Starting new version"
IMAGE="$NEW_IMAGE" docker compose up -d --no-build --remove-orphans

echo ">> Waiting for health check"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo ">> Healthy"
    echo "$NEW_IMAGE" > .last_image
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done

echo "!! New version failed health check"
docker compose logs --tail=50 api || true

if [ -n "$PREV_IMAGE" ]; then
  echo ">> Rolling back to $PREV_IMAGE"
  IMAGE="$PREV_IMAGE" docker compose up -d --no-build
fi
exit 1
