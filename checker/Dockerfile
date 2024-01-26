FROM ultralytics/ultralytics:latest

RUN <<EOF 
  pip install --no-cache shapely==2.0.2 lapx==0.5.5  
  apt-get update 
  apt-get upgrade -y
  conda remove --force ffmpeg -y
  export DEBIAN_FRONTEND=noninteractive 
  apt-get -y install --no-install-recommends \
    jq \
    wget \
    ffmpeg

EOF

ENV SOURCE_DIRECTORY="/src" \
    CONFIG_DIRECTORY="/config" \
    SIDEWALK_EVENTS_DIRECTORY="/sidewalk-events" \
    DELETED_FILE_DIRECTORY="/deleted" \
    LOCAL_EVENTS_PATH="/local-events" \
    DATA_DIRECTORY="/data" \
    CLIP_NAME="sidewalk_rider_clip.mp4" \
    DELETED_FILE_DIRECTORY="/deleted"

COPY ./src/* /src/
COPY ./run.sh /src/

ENTRYPOINT ["/src/run.sh"]