#!/bin/bash
set -e

docker -c default buildx bake --push --file docker-compose.yml