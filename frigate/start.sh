if [[ -z $1 ]]; then
    echo "no host given"
    exit 1
fi
export DOCKER_CONTEXT="$1"

docker compose down
ssh $1 mkdir -p frigate/db
ssh $1 mkdir -p frigate/config
scp config/config.yml $1:frigate/config/config.yml

docker compose up -d
docker compose logs -f
