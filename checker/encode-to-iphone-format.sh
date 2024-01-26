#
#
#
#
#
# TODO:  This script is not done.
#
#
#
#
#

#!/bin/bash

# ffmpeg -nostdin -y -i "$1" -vcodec libx264 -profile:v main -level 3.1 \
#     -preset medium \
#     -crf 23 \
#     -x264-params ref=4 -acodec copy -movflags +faststart output.mp4

# ffmpeg -nostdin -y -i "$1" -vcodec libx264 -profile:v main -level 3.1 \
#     -preset medium \
#     -crf 23 \
#     -x264-params ref=4 -movflags +faststart output-same-size.mp4


# ffmpeg -nostdin -y -v quiet -hide_banner -hwaccel cuda -i "$INPUT_TO_SPEEDUP" -s 2688x1520 -r 30 -pix_fmt yuv420p -c:v h264_nvenc -filter:v "setpts=PTS/8" "$SPEDUP_FILE"



### here

# ffmpeg -nostdin -y -i "$1" -vcodec libx264 -profile:v main -level 3.1 \
#     -preset medium \
#     -crf 23 \
#     -x264-params ref=4 -movflags +faststart output-x264.mp4

ffmpeg -nostdin -y -hide_banner -hwaccel cuda -i "$1" -c:v hevc_nvenc -profile:v main -rc:v vbr -cq:v 51 -tag:v hvc1 "$1-cuda-out-720.mp4"
ffmpeg -nostdin -y -hide_banner -hwaccel cuda -i "$1" -c:v hevc_nvenc -profile:v main -rc:v vbr -cq:v 51  -vf "scale=-2:1920" -tag:v hvc1 "$1-cuda-out.mp4"

# ffmpeg -nostdin -y -hide_banner -hwaccel cuda -i "$1" -c:v hevc_nvenc -rc:v vbr -cq:v 51  -vf "scale=-2:1920" -tag:v hvc1 output-x265-cuda.mp4
# ffmpeg -nostdin -y -hide_banner -hwaccel cuda -i "$1" -c:v hevc_nvenc -rc:v vbr -cq:v 51  -vf "scale=-2:720" -tag:v hvc1 output-x265-cuda-720.mp4

ffmpeg -nostdin -y -i "$1" -vcodec libx265 -profile:v main \
    -preset fast \
    -crf 45 \
    -vf "scale=-2:1920" \
    -tag:v hvc1 \
    "$1-libx265.mp4"

du -h *.mp4

# ls -al