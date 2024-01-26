#!/bin/bash
usage()
{
  echo "Usage: run.sh 
        Make sure the following environment variables are set:
                            SIDEWALK_URL='sidewalk.home.arpa:3010'
                            FRIGATE_URL='frigate.home.arpa:5000'
                            SOURCE_DIRECTORY='/src'
                            SIDEWALK_EVENTS_DIRECTORY='/sidwalk-events'                            
                            LOCAL_EVENTS_PATH='/local-events'                            
                            DATA_DIRECTORY='/data'                            
                            CLIP_NAME='sidewalk_rider_clip.mp4'                            
                            DELETED_FILE_DIRECTORY='/config'                            
                        "
  exit 2
}
echo "$SIDEWALK_URL"
if [[ -z "${SIDEWALK_URL}" ]]; then
    echo "$0: missing SIDEWALK_URL"
    usage
    exit 4
fi

if [[ -z "${FRIGATE_URL}" ]]; then
    echo "$0: missing FRIGATE_URL"
    usage
    exit 4
fi

if [[ -z "${SOURCE_DIRECTORY}" ]]; then
    echo "$0: missing SOURCE_DIRECTORY"
    usage
    exit 4
fi

if [[ -z "${CONFIG_DIRECTORY}" ]]; then
    echo "$0: missing CONFIG_DIRECTORY"
    usage
    exit 4
fi

if [[ -z "${SIDEWALK_EVENTS_DIRECTORY}" ]]; then
    echo "$0: missing SIDEWALK_EVENTS_DIRECTORY"
    usage
    exit 4
fi

if [[ -z "${LOCAL_EVENTS_PATH}" ]]; then
    echo "$0: missing LOCAL_EVENTS_PATH"
    usage
    exit 4
fi

if [[ -z "${DATA_DIRECTORY}" ]]; then
    echo "$0: missing DATA_DIRECTORY"
    usage
    exit 4
fi

if [[ -z "${CLIP_NAME}" ]]; then
    echo "$0: missing CLIP_NAME"
    usage
    exit 4
fi

if [[ -z "${DELETED_FILE_DIRECTORY}" ]]; then
    echo "$0: missing DELETED_FILE_DIRECTORY"
    usage
    exit 4
fi

detect () {
    python ${SOURCE_DIRECTORY}/track.py "$1" "$2" "$3" $4 
}

YOLO_WEIGHTS_FILE="$DATA_DIRECTORY/yolov8x.pt"
if ! [[ -f "$YOLO_WEIGHTS_FILE" ]]; then   
    wget -nv "https://github.com/ultralytics/assets/releases/download/v8.1.0/yolov8x.pt" -O "$YOLO_WEIGHTS_FILE"
fi

mkdir -p "$DELETED_FILE_DIRECTORY"
# FALSE_POSTIVES_FILE="$DELETED_FILE_DIRECTORY/files.txt"
# rm $FALSE_POSTIVES_FILE 2> /dev/null

STOP_DETECTING_SIGNAL_FILE="./stop-detecting.sig"

ZONE_VERSION=0

while true; do
    curl -X "POST" "$SIDEWALK_URL/check-overlapping"          

    SUBMISSION_RUN_FILE="$SIDEWALK_EVENTS_DIRECTORY/lastSubmissionRun.json"
    # cp "$LAST_SUBMISSION_RUN_SCP_SOURCE" "$SUBMISSION_RUN_FILE"

    ZONE_DEFINITIONS_PATH="$CONFIG_DIRECTORY/zones.json"
    # scp "$ZONE_DEFINITIONS_SCP_SOURCE" "$ZONE_DEFINITIONS_PATH"

    LAST_RUN_TIME=$(cat "$SUBMISSION_RUN_FILE" | jq -r .lastRunTime)
    echo "analyzing since: $LAST_RUN_TIME"

    LAST_RUN_TIME=$(echo "$LAST_RUN_TIME" | tr -d ',')

    LAST_RUN_TIME_EPOCH=$(date -d "$LAST_RUN_TIME" +"%s")

    EVENTS="$(curl -s "$FRIGATE_URL/api/events?after=$LAST_RUN_TIME_EPOCH&limit=200")"
    EVENT_IDS="$(echo "$EVENTS" | jq -r .[].id)"

    COUNTER=0

    while IFS= read -r EVENT_ID; do
        # if (( $COUNTER >= 50 )); then
        #     break;
        # fi

        echo $EVENT_ID
        mkdir -p "$LOCAL_EVENTS_PATH/$EVENT_ID"
        
        CLIP_PATH="$LOCAL_EVENTS_PATH/$EVENT_ID/$CLIP_NAME"
        
        OUTPUT_VIDEO_PATH="$LOCAL_EVENTS_PATH/$EVENT_ID/output.avi"

        OUTPUT_VIDEO_MP4_PATH="$LOCAL_EVENTS_PATH/$EVENT_ID/$EVENT_ID.mp4"
        OUTPUT_RESULTS_PATH="$LOCAL_EVENTS_PATH/$EVENT_ID/results.json"

        if ! [[ -f "$OUTPUT_RESULTS_PATH" ]]; then
            if [[ -f "$STOP_DETECTING_SIGNAL_FILE" ]]; then
                rm "$STOP_DETECTING_SIGNAL_FILE"
                exit 1;
            fi
            wget -nv "$FRIGATE_URL/api/events/$EVENT_ID/clip.mp4" -O "$CLIP_PATH"        

            if ! [[ -f "$CLIP_PATH" ]]; then
                echo 'clip failed to download'
                continue  
            fi

            FILE_SIZE=$(du -m "$CLIP_PATH" | cut -f 1)
            MAX_SIZE=74
            if [ $FILE_SIZE -gt $MAX_SIZE ]; then     
                echo 'deleting'
                curl -X "DELETE" "$FRIGATE_URL/api/events/$EVENT_ID"            
                # echo $EVENT_ID >> $FALSE_POSTIVES_FILE
                continue
            fi
            detect "$CLIP_PATH" "$OUTPUT_VIDEO_PATH" "$OUTPUT_RESULTS_PATH" "$SHOW_VIDEO_ARGS"

            if [[ -f "$STOP_DETECTING_SIGNAL_FILE" ]]; then
                rm "$STOP_DETECTING_SIGNAL_FILE"
                exit 1;
            fi

            if [[ -f "$OUTPUT_RESULTS_PATH" ]]; then

                if [[ -f "$OUTPUT_VIDEO_PATH" ]]; then
                    echo 'reencoding to mp4'
                    ffmpeg -nostdin -y -v quiet -hide_banner -loglevel error -i "$OUTPUT_VIDEO_PATH" -c:v libx264 -f mp4 "$OUTPUT_VIDEO_MP4_PATH"
                    rm "$OUTPUT_VIDEO_PATH"
                fi

                IS_ONLY_STATIONARY="$(cat "$OUTPUT_RESULTS_PATH" | jq -r .hasOnlyStationary)"
                HAS_DETECTIONS="$(cat "$OUTPUT_RESULTS_PATH" | jq -r .hasDetectedInZones)"

                echo "detections: $HAS_DETECTIONS stationary - $IS_ONLY_STATIONARY"

                if [[ "$IS_ONLY_STATIONARY" = "true" ]] || [[ "$HAS_DETECTIONS" = "false" ]] ; then
                    echo 'deleting'

                    if [[ -f "$OUTPUT_VIDEO_MP4_PATH" ]]; then
                        cp "$OUTPUT_VIDEO_MP4_PATH" "$DELETED_FILE_DIRECTORY/$EVENT_ID.mp4"
                    fi
                    #   ffmpeg -nostdin -y -v quiet -hide_banner -loglevel error -i "$OUTPUT_VIDEO_PATH" -c:v libx264 -f mp4 "$DELETED_FILE_DIRECTORY/$EVENT_ID.mp4"
                    
                    curl -X "DELETE" "$FRIGATE_URL/api/events/$EVENT_ID"      
                    #   echo $EVENT_ID >> $FALSE_POSTIVES_FILE
                fi
            fi
        fi
        
        ((COUNTER++))
    done <<< "$EVENT_IDS"
  sleep 5m
done