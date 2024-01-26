#!/bin/bash

FAILED_FILES_PATH="$1"

EVENTS_PATH="/mnt/d/311-events/events"
ANALYSIS_RESULTS_PATH="/mnt/d/311-events-analysis"

TOTAL_EXAMINED=0
TOTAL_SERVICE_REQUESTS=0
UNDETECTED_COUNTER=0
NOT_ANALYZED_COUNTER=0
CORRUPT_COUNTER=0
NO_SR_COUNTER=0
# TOTAL_FILES="$(echo "$VIDEO_FILES" | wc -l)"
PROGRAM_VERSION=0

while IFS= read -r VIDEO <&3; do
    echo "$VIDEO"

    CLIP_SUB_PATH="$(realpath --relative-to $EVENTS_PATH $VIDEO)"
    EVENT_ID="$(dirname "$CLIP_SUB_PATH")"

    mkdir -p "$ANALYSIS_RESULTS_PATH/$EVENT_ID"
    AUDIT_RESULTS_VERSION_PATH="$ANALYSIS_RESULTS_PATH/$EVENT_ID/audit-version.txt"
    AUDIT_RESULTS_PATH="$ANALYSIS_RESULTS_PATH/$EVENT_ID/audit-result.txt"
    
    if [[ -f "$AUDIT_RESULTS_VERSION_PATH" ]]; then
      AUDIT_VERSION=$(< "$AUDIT_RESULTS_VERSION_PATH")
    else
      AUDIT_VERSION="-1"
    fi

    if [[ "$AUDIT_VERSION" != "$PROGRAM_VERSION" ]] || ! [[ -f "$AUDIT_RESULTS_PATH" ]]; then
      
      read -p "violation observed? [y/n]" IS_CORRECT      
      
      if [[ "$IS_CORRECT" == "y" ]]; then        
        echo "violation observed"
        echo "valid" > "$AUDIT_RESULTS_PATH"
        echo "$PROGRAM_VERSION" > "$AUDIT_RESULTS_VERSION_PATH"
      elif [[ "$IS_CORRECT" == "n" ]]; then        
        echo "NO VIOLATION"
        echo "invalid" > "$AUDIT_RESULTS_PATH"  
        echo "$PROGRAM_VERSION" > "$AUDIT_RESULTS_VERSION_PATH"
      else
        echo "error incorrect input" 
        exit 1
      fi
    fi        
done 3< $FAILED_FILES_PATH
