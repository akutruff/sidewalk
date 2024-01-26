#!/bin/bash
set -e

echo "deploying to ${DOCKER_CONTEXT:-default}"
# ./build.sh
docker -c default buildx bake --push --file docker-compose.yml
docker compose down
docker pull akutruff/sidewalk
docker compose up -d 
docker compose logs -f  