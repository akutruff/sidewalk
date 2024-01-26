if [[ -z $1 ]]; then
    echo "no host given"
    exit 1
fi

export DOCKER_CONTEXT="$1"
docker compose down

TEMP_BACKUP_DIR="/tmp/frigate/backup"

mkdir -p $TEMP_BACKUP_DIR

rsync -az --del --progress $1:frigate/db/ ${TEMP_BACKUP_DIR}/db/
rsync -az --del --progress ${TEMP_BACKUP_DIR}/ nas:/volume1/Downloads/backups/frigate/