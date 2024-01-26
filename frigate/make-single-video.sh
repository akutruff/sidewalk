#!/bin/bash

EVENTS_PATH="/mnt/d/311-events/events"
REFERENCE_VIDEO="$EVENTS_PATH/1703024133.210388-bnus6x/sidewalk_rider_clip.mp4"
OUTPUT_FILE="/mnt/d/311-notable/all-events-timelapse-8x.mp4"

TEMP_PATH="$(mktemp --directory)"
FILE_INDEX="$TEMP_PATH/video-files.txt"
FAILED_FILES="$TEMP_PATH/failed-files.txt"
STOP_FILE="./stop"

echo "File index: $FILE_INDEX"
echo "Failed files: $FAILED_FILES"

REFERENCE_PROPERTIES="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,width,height -of default=noprint_wrappers=1:nokey=1 "$REFERENCE_VIDEO")"

echo "Finding files..."

VIDEO_FILES="$(find "$EVENTS_PATH" -name 'sidewalk_rider_clip.mp4' | sort -nr )"

COUNTER=0

# while IFS= read -r VIDEO; do
#     CONVERTED_FILE="$(dirname "$VIDEO")/converted.mp4"
#     SPEDUP_FILE="$(dirname "$VIDEO")/spedup-8x.mp4"
    
#     rm "$SPEDUP_FILE"
# done <<< "$VIDEO_FILES"

while IFS= read -r VIDEO; do

    if [[ -f "$STOP_FILE" ]]; then
      rm "$STOP_FILE"
      echo "stopping"
      exit 0;
    fi

    CONVERTED_FILE="$(dirname "$VIDEO")/converted.mp4"
    SPEDUP_FILE="$(dirname "$VIDEO")/spedup-8x.mp4"
    
    INPUT_FILE="$VIDEO"

    if [[ -f "$CONVERTED_FILE" ]]; then
      INPUT_FILE="$CONVERTED_FILE"
    fi
    
    INPUT_PROPERTIES="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,width,height -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE")"
    
    echo "$COUNTER - $INPUT_FILE" $INPUT_PROPERTIES
        
    if [[ "$INPUT_PROPERTIES" != "$REFERENCE_PROPERTIES" ]]; then        
        echo "converting $INPUT_FILE -> $CONVERTED_FILE"
        ffmpeg -nostdin -y -v quiet -hide_banner -loglevel error -i "$VIDEO" -s 2688x1520 -r 30 -pix_fmt yuv420p -c:v libx264 -profile:v high -b:v 6200575 -f mp4 "$CONVERTED_FILE"
        INPUT_FILE="$CONVERTED_FILE"
    fi
    
    MINIMUM_SIZE=512
    FILE_SIZE=$(du -k "$INPUT_FILE" | cut -f 1)
    if [[ $FILE_SIZE -ge $MINIMUM_SIZE ]]; then
        if ! [[ -f "$SPEDUP_FILE" ]]; then
          ffmpeg -nostdin -y -v quiet -hide_banner -hwaccel cuda -i "$INPUT_FILE" -c:v h264_nvenc -filter:v "setpts=PTS/8" "$SPEDUP_FILE"
        #   INPUT_FILE="$CONVERTED_FILE"
        fi
    
        echo "file $SPEDUP_FILE" >> $FILE_INDEX    
        # echo "file $INPUT_FILE" >> $FILE_INDEX
    else            
        echo "ERROR: $INPUT_FILE" 1>&2
        echo "$INPUT_FILE" >> "$FAILED_FILES"
    fi
    
    ((COUNTER++))
done <<< "$VIDEO_FILES"

echo "concatenating..."
ffmpeg -nostdin -y -v quiet -hide_banner -loglevel error -f concat -safe 0 -i "$FILE_INDEX" -c copy "$OUTPUT_FILE"

# echo "concatenating..."
# CONCATENATED_FILE="$TEMP_PATH/concated.mp4"
# ffmpeg -nostdin -y -v quiet -hide_banner -loglevel error -f concat -safe 0 -i "$FILE_INDEX" -c copy "$CONCATENATED_FILE"
# echo "speeding up..."
# ffmpeg -nostdin -y -hide_banner -hwaccel cuda -i "$CONCATENATED_FILE" -c:v h264_nvenc -filter:v "setpts=PTS/4" "$OUTPUT_FILE"
