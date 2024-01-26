if [[ -z $1 ]]; then
    echo "no host given"
    exit 1
fi
export DOCKER_CONTEXT="$1"

docker compose down

rsync -az --del --progress --chown=ubuntu:ubuntu config/ $1:frigate/config/

TEMP_BACKUP_DIR="/tmp/frigate/backup"

mkdir -p ${TEMP_BACKUP_DIR}

rsync -az --del --progress nas:/volume1/Downloads/backups/frigate/ ${TEMP_BACKUP_DIR}/
rsync -az --del --progress --chown=ubuntu:ubuntu ${TEMP_BACKUP_DIR}/db/ $1:frigate/db/
