#!/bin/bash

EVENTS_PATH="/mnt/d/311-events/events"
ANALYSIS_RESULTS_PATH="/mnt/d/311-events-analysis"

TEMP_PATH="$(mktemp --directory)"
FAILED_FILES="$TEMP_PATH/failed-files.txt"

# 1704403700.177818-h1vyjr
if [[ -n "$1" ]]; then
  VIDEO_FILES="$EVENTS_PATH/$1/sidewalk_rider_clip.mp4"      
else
  echo "Finding files..."
  VIDEO_FILES="$(find "$EVENTS_PATH" -name 'sidewalk_rider_clip.mp4' | sort -nr )"  
fi

TOTAL_EXAMINED=0
TOTAL_SERVICE_REQUESTS=0
UNDETECTED_COUNTER=0
NOT_ANALYZED_COUNTER=0
CORRUPT_COUNTER=0
NO_SR_COUNTER=0
AUDITED_AS_INVALID_COUNTER=0
TOTAL_AUDITED=0
TOTAL_FILES="$(echo "$VIDEO_FILES" | wc -l)"

while IFS= read -r VIDEO; do
    CLIP_SUB_PATH="$(realpath --relative-to $EVENTS_PATH $VIDEO)"
    EVENT_ID="$(dirname "$CLIP_SUB_PATH")"

    CLIP_PATH="$EVENTS_PATH/$CLIP_SUB_PATH"
    
    SR_PATH="$EVENTS_PATH/$EVENT_ID/SR.json"

    if ! [[ -f "$SR_PATH" ]]; then
      ((NO_SR_COUNTER++))
      continue;
    fi
    
    ((TOTAL_SERVICE_REQUESTS++))

    OUTPUT_RESULTS_SUB_PATH="$EVENT_ID/results.json"
    OUTPUT_RESULTS_PATH="$ANALYSIS_RESULTS_PATH/$OUTPUT_RESULTS_SUB_PATH"
    AUDIT_RESULTS_PATH="$ANALYSIS_RESULTS_PATH/$EVENT_ID/audit-result.txt"

    MINIMUM_SIZE=512
    FILE_SIZE=$(du -k "$VIDEO" | cut -f 1)
    if [[ $FILE_SIZE -lt $MINIMUM_SIZE ]]; then      
      ((TOTAL_EXAMINED++))
      ((CORRUPT_COUNTER++))
    elif ! [[ -f "$OUTPUT_RESULTS_PATH" ]]; then
      ((NOT_ANALYZED_COUNTER++))
    elif [[ -f "$AUDIT_RESULTS_PATH" ]]; then
      ((TOTAL_EXAMINED++))
      ((TOTAL_AUDITED++))

      AUDIT_RESULT=$(< "$AUDIT_RESULTS_PATH")      
      if [[ "$AUDIT_RESULT" == "invalid" ]]; then        
        ((AUDITED_AS_INVALID_COUNTER++))
      fi
    else
      ((TOTAL_EXAMINED++))    
      HAS_DETECTED="$(cat "$OUTPUT_RESULTS_PATH" | jq -r .hasDetectedInZones)"
      
      if [[ "$HAS_DETECTED" == "false" ]]; then
          ((UNDETECTED_COUNTER++))
          echo "error: no detection: $CLIP_PATH" 1>&2
          echo "$CLIP_PATH" >> "$FAILED_FILES"
      fi
    fi
done <<< "$VIDEO_FILES"

if [[ -f "$FAILED_FILES" ]]; then
  echo "errors:"
  cat "$FAILED_FILES" 2>/dev/null
  echo
fi

echo "total files: $TOTAL_FILES"
echo "service requests: $TOTAL_SERVICE_REQUESTS"
echo "not analyzed: $NOT_ANALYZED_COUNTER"
echo "examined: $TOTAL_EXAMINED"
echo "corrupt: $CORRUPT_COUNTER"
echo "audited as invalid: $AUDITED_AS_INVALID_COUNTER"
echo "total audited: $TOTAL_AUDITED"
echo "no detections: $UNDETECTED_COUNTER"

POTENTIAL_ERRORS=$(($CORRUPT_COUNTER + $UNDETECTED_COUNTER + $AUDITED_AS_INVALID_COUNTER))

PERCENT_ERRORS=$((($POTENTIAL_ERRORS * 1000) / $TOTAL_EXAMINED))
ACCURACY=$((1000 - $PERCENT_ERRORS))
WHOLE_PART=$(($ACCURACY / 10))
DECIMAL_PART=$(($ACCURACY - 10 * $WHOLE_PART))

echo "$WHOLE_PART.$DECIMAL_PART% accuracy"

echo "$FAILED_FILES"

if [[ $UNDETECTED_COUNTER -gt 0 ]]; then
  read -p "should audit? [y/N]" SHOULD_AUDIT      

  if [[ "$SHOULD_AUDIT" == "y" ]]; then        
    ./audit-clips.sh "$FAILED_FILES"
  fi
fi