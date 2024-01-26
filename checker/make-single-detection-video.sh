#!/bin/bash

detect () {
    docker run --rm -t --ipc=host --gpus all \
        -v ./src:/src \
        -v $1:/events \
        -v $2:/results \
        akutruff/ultra:latest \
        python /src/track.py "/events/$3" "/events/$4" "/results/$5" $6 $7
}

EVENTS_PATH="/mnt/d/311-events/events"
ANALYSIS_RESULTS_PATH="/mnt/d/311-events-analysis"

REFERENCE_VIDEO="$EVENTS_PATH/1703024133.210388-bnus6x/sidewalk_rider_clip.mp4"
OUTPUT_FILE="/mnt/d/311-notable/all-events-analyzed-timelapse-8x.mp4"

TEMP_PATH="$(mktemp --directory)"
FILE_INDEX="$TEMP_PATH/video-files.txt"
FAILED_FILES="$TEMP_PATH/failed-files.txt"
STOP_FILE="./stop"

echo "File index: $FILE_INDEX"
echo "Failed files: $FAILED_FILES"

REFERENCE_PROPERTIES="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,width,height -of default=noprint_wrappers=1:nokey=1 "$REFERENCE_VIDEO")"

if [[ -n "$1" ]]; then
  VIDEO_FILES="$EVENTS_PATH/$1/sidewalk_rider_clip.mp4"    
  SHOULD_CONCATENATE=false
else
  echo "Finding files..."
  VIDEO_FILES="$(find "$EVENTS_PATH" -name 'sidewalk_rider_clip.mp4' | sort -nr )"
  SHOULD_CONCATENATE=true
fi


COUNTER=0
ERROR_COUNTER=0
TOTAL_FILES="$(echo "$VIDEO_FILES" | wc -l)"
# Zone changes:
# 11/30/16:48:31
# 12/08/12:51:48


# while IFS= read -r VIDEO; do
#     CONVERTED_FILE="$(dirname "$VIDEO")/converted.mp4"
#     SPEDUP_FILE="$(dirname "$VIDEO")/spedup-8x.mp4"
    
#     rm "$SPEDUP_FILE"
# done <<< "$VIDEO_FILES"

PASS_THROUGH_REST=false

ZONE_VERSION=0

# bump whenever processing needs to change
PROGRAM_VERSION=0

while IFS= read -r VIDEO; do

    if [[ -f "$STOP_FILE" ]]; then
      rm "$STOP_FILE"
      echo "stopping"
      # exit 0;
      break
    fi

    # if (( $COUNTER >= 10 )); then
    #     break;
    # fi

    CLIP_SUB_PATH="$(realpath --relative-to $EVENTS_PATH $VIDEO)"
    EVENT_ID="$(dirname "$CLIP_SUB_PATH")"

    CLIP_PATH="$EVENTS_PATH/$CLIP_SUB_PATH"
    
    SR_PATH="$EVENTS_PATH/$EVENT_ID/SR.json"

    if ! [[ -f "$SR_PATH" ]]; then
      echo "ERROR: no SR found for $CLIP_PATH" 1>&2
      echo "$CLIP_PATH - no service request" >> "$FAILED_FILES"
      continue;
    fi

    OUTPUT_VIDEO_SUB_PATH="$EVENT_ID/output.avi"
    OUTPUT_VIDEO_PATH="$EVENTS_PATH/$OUTPUT_VIDEO_SUB_PATH"

    OUTPUT_VIDEO_MP4_PATH="$EVENTS_PATH/$EVENT_ID/analyzed.mp4"

    mkdir -p "$ANALYSIS_RESULTS_PATH/$EVENT_ID"
    OUTPUT_RESULTS_SUB_PATH="$EVENT_ID/results.json"
    OUTPUT_RESULTS_PATH="$ANALYSIS_RESULTS_PATH/$OUTPUT_RESULTS_SUB_PATH"

    CONVERTED_FILE="$EVENTS_PATH/$EVENT_ID/converted.mp4"  
    SPEDUP_FILE="$EVENTS_PATH/$EVENT_ID/analyzed-spedup-8x.mp4"
    
    INPUT_FILE="$CLIP_PATH"

    ANALYSIS_RESULTS_VERSION_PATH="$ANALYSIS_RESULTS_PATH/$EVENT_ID/version.txt"

    if [[ -n "$1" ]] && [[ "$2" == "--clear" ]]; then
      echo "clearing: $EVENT_ID"
      rm "$OUTPUT_RESULTS_PATH" 2>/dev/null
      rm "$SPEDUP_FILE" 2>/dev/null      
    fi    

    if [[ -f "$CONVERTED_FILE" ]]; then
      INPUT_FILE="$CONVERTED_FILE"
    fi

    # echo $INPUT_FILE
    echo "$COUNTER/$TOTAL_FILES - $EVENTS_PATH/$EVENT_ID"
    
    if [[ "$EVENT_ID" == "1701380164.514627-9gvevx" ]]; then
      echo 'encountered 11/30 zone change'
      ZONE_VERSION=1
    elif [[ $EVENT_ID == "1700778325.841474-03pdr6" ]]; then
      echo 'encountered 11/23 zone change'
      ZONE_VERSION=2      
      PASS_THROUGH_REST=true
    fi    

    if [[ -f "$ANALYSIS_RESULTS_VERSION_PATH" ]]; then
      EVENT_ANALYSIS_VERSION=$(< "$ANALYSIS_RESULTS_VERSION_PATH")
    else
      EVENT_ANALYSIS_VERSION="-1"
    fi
    
    if [[ "$EVENT_ANALYSIS_VERSION" != "$PROGRAM_VERSION" ]]; then
      # echo "$EVENT_ID: re-running because of old version $EVENT_ANALYSIS_VERSION"
      
      if [[ -f "$OUTPUT_RESULTS_PATH" ]]; then
        rm "$OUTPUT_RESULTS_PATH"          
      fi
      if [[ -f "$SPEDUP_FILE" ]]; then
        rm "$SPEDUP_FILE"          
      fi            
    fi
    
    # INPUT_PROPERTIES="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,width,height -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE")"
    
    # echo "$COUNTER - $INPUT_FILE" $INPUT_PROPERTIES
        
    # if [[ "$INPUT_PROPERTIES" != "$REFERENCE_PROPERTIES" ]]; then        
    #     echo "converting $INPUT_FILE -> $CONVERTED_FILE"
    #     ffmpeg -nostdin -y -v quiet -hide_banner -loglevel error -i "$VIDEO" -s 2688x1520 -r 30 -pix_fmt yuv420p -c:v libx264 -profile:v high -b:v 6200575 -f mp4 "$CONVERTED_FILE"
    #     INPUT_FILE="$CONVERTED_FILE"
    # fi    
        
    MINIMUM_SIZE=512
    FILE_SIZE=$(du -k "$INPUT_FILE" | cut -f 1)
    if [[ $FILE_SIZE -ge $MINIMUM_SIZE ]]; then

      # rm "$OUTPUT_RESULTS_PATH"

      if [[ "$PASS_THROUGH_REST" = true ]]; then                    
        INPUT_TO_SPEEDUP="$INPUT_FILE"
      elif ! [[ -f "$OUTPUT_RESULTS_PATH" ]]; then
        detect "$EVENTS_PATH" "$ANALYSIS_RESULTS_PATH" "$CLIP_SUB_PATH" "$OUTPUT_VIDEO_SUB_PATH" "$OUTPUT_RESULTS_SUB_PATH" "$ZONE_VERSION" --show-video
        INPUT_TO_SPEEDUP="$OUTPUT_VIDEO_PATH"
      fi

      if ! [[ -f "$SPEDUP_FILE" ]]; then          
        ffmpeg -nostdin -y -v quiet -hide_banner -hwaccel cuda -i "$INPUT_TO_SPEEDUP" -s 2688x1520 -r 30 -pix_fmt yuv420p -c:v h264_nvenc -filter:v "setpts=PTS/8" "$SPEDUP_FILE"
        echo "$PROGRAM_VERSION" > "$ANALYSIS_RESULTS_VERSION_PATH"
      fi
    fi
    
    if [[ -f "$SPEDUP_FILE" ]]; then
        echo "$SPEDUP_FILE"
        echo "file $SPEDUP_FILE" >> $FILE_INDEX    
    else            
        ((ERROR_COUNTER++))
        echo "ERROR: $INPUT_FILE" 1>&2
        echo "$INPUT_FILE" >> "$FAILED_FILES"
    fi
    
    ((COUNTER++))    

done <<< "$VIDEO_FILES"

if [[ -f "$FAILED_FILES" ]]; then
  echo "errors:"
  cat "$FAILED_FILES" 2>/dev/null
  echo
  echo "total errors: $ERROR_COUNTER"
fi

echo "total files: $COUNTER"

if [[ "$SHOULD_CONCATENATE" = true ]]; then                      
  echo "concatenating..."
  ffmpeg -nostdin -y -v quiet -hide_banner -loglevel error -f concat -safe 0 -i "$FILE_INDEX" -c copy "$OUTPUT_FILE"
fi
