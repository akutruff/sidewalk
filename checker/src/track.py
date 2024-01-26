from collections import defaultdict

from shapely.geometry import Point
from shapely.geometry.polygon import Polygon

import json
import cv2
import numpy as np

from ultralytics import YOLO

import sys

video_path = sys.argv[1]
output_path = sys.argv[2]
results_path = sys.argv[3]

if len(sys.argv) >= 5 and sys.argv[4] == '--show-video': 
    should_show_video=True
else:
    should_show_video=False

results_path = sys.argv[3]
print('video:', video_path)
print('output:', output_path)
print('results:', results_path)

# Check for boxA and boxB intersection
def checkIntersection(boxA, boxB):    
    x = max(boxA[0], boxB[0])
    y = max(boxA[1], boxB[1])
    w = min(boxA[0] + boxA[2], boxB[0] + boxB[2]) - x
    h = min(boxA[1] + boxA[3], boxB[1] + boxB[3]) - y

    foundIntersect = True
    if w < 0 or h < 0:
        foundIntersect = False

    return(foundIntersect, [x, y, w, h])

# Load the YOLOv8 model
model = YOLO('/data/yolov8x.pt')

# Open the video file
cap = cv2.VideoCapture(video_path)

# Store the track history
track_history = defaultdict(lambda: [])
track_box_history = defaultdict(lambda: [])

if should_show_video:
    video_writer = cv2.VideoWriter(output_path,
        cv2.VideoWriter_fourcc(*'mp4v'),
        int(cap.get(5)),
        (int(cap.get(3)), int(cap.get(4))))

zones_f = open('/config/zones.json')
zones = json.load(zones_f)
zones_f.close()

zone_polys = dict()

for id, pts in zones.items():
    zone_polys[id]=Polygon([*map(lambda x: tuple(x), pts), tuple(pts[-1])])


int_coords = lambda x: np.array(x).round().astype(int)

frame_number = 0
# max_frames = 30

while cap.isOpened():    
    success, frame = cap.read()
    # if frame_number >= max_frames:
    #     break
    if success:       
        results = model.track(frame, persist=True, classes=[1, 3], verbose=False)
        
        print('\r', frame_number, end="")

        if should_show_video:
            annotated_frame = results[0].plot(boxes=False, masks=False)
            for id, pts in zones.items():
                points = np.array(pts, np.int32)
                points.reshape((-1, 1, 2))
                cv2.polylines(annotated_frame, [points], isClosed=True, color=(0,230,0), thickness=2)

        if results[0].boxes.id != None:
            # Get the boxes and track IDs
            boxes = results[0].boxes.xywh.cpu()
            track_ids = results[0].boxes.id.int().cpu().tolist()
            
            for box, track_id in zip(boxes, track_ids):
                x, y, w, h = box
                track = track_history[track_id]
                track_box_history[track_id].append(box.tolist())
                track.append((float(x), float(y)))  # x, y center point
                if len(track) > 30:  # retain 90 tracks for 90 frames
                    track.pop(0)
                
                if should_show_video:
                    # Draw bottom center
                    x0, y0, x1, y1 = int_coords([x - 5, y + 0.5 * h - 5, x + 10, y + 0.5 * h + 10])                
                    cv2.rectangle(annotated_frame, (x0, y0), (x1, y1), (230, 0, 0), 5) 

                    box_history = track_box_history[track_id];
                    has_detected_zone = False
                    for x, y, w, h in box_history:
                        if has_detected_zone:
                            break
                        bottom_center = Point(x, y + 0.5 * h)                        
                        for zone_id, poly in zone_polys.items():                        
                            if poly.contains(bottom_center):
                                has_detected_zone = True
                                break
                    
                    first_box = box_history[0]
                    last_box = box_history[-1]
                    is_stationary, interRect = checkIntersection(first_box, last_box)
        
                    if has_detected_zone and not(is_stationary):
                        # Draw the tracking lines
                        points = np.hstack(track).astype(np.int32).reshape((-1, 1, 2))
                        cv2.polylines(annotated_frame, [points], isClosed=False, color=(230, 230, 230), thickness=10)
                        # x1, y1, w1, h1 = last_box
                        # cv2.rectangle(annotated_frame, int_coords((x1 - 0.5 * w1, y1 - 0.5 * h1)), int_coords((x1 + 0.5 * w1, y1 + 0.5 * h1)), (0, 0, 255), 3) 
                        x, y, w, h = box
                        cv2.rectangle(annotated_frame, int_coords((x - 0.5 * w, y - 0.5 * h)), int_coords((x + 0.5 * w, y + 0.5 * h)), (0, 0, 255), 3) 
                        

        if should_show_video:
            video_writer.write(annotated_frame)
    else:
        # Break the loop if the end of the video is reached
        break
    
    frame_number += 1

print('detection done')

total_stationary = 0
total_in_zones = 0
box_results=[]
for id, boxes in track_box_history.items():                
    detected_zones = set()
    
    for x, y, w, h in boxes:
        for zone_id, poly in zone_polys.items():
            bottom_center = Point(x, y + 0.5 * h)
            if poly.contains(bottom_center):
                detected_zones.add(zone_id)

    detected_zones = list(detected_zones)
    detected_zones.sort()

    first_box = boxes[0]
    last_box = boxes[-1]
    is_stationary, interRect = checkIntersection(first_box, last_box)
    print(id, 'is stationary: ', is_stationary, ' zones ', detected_zones)
        
    if len(detected_zones) > 0:
        total_in_zones += 1

        if is_stationary:        
            total_stationary += 1        
    
    box_results.append({'id': id, 'detectedZones': detected_zones, 'isStationary': is_stationary, })
            

has_only_stationary = total_stationary == total_in_zones
if has_only_stationary:
    print('File has only stationary')

has_detected_in_zones = total_in_zones > 0
if has_detected_in_zones:
    print('File has detected items ', total_in_zones)

f = open(results_path, "w")
f.write(json.dumps({'objects': box_results, 'totalStationary': total_stationary, 'hasOnlyStationary': has_only_stationary, 'hasDetectedInZones': has_detected_in_zones}, indent=2))

f.close()

# Release the video capture object and close the display window
cap.release()
if should_show_video:
    video_writer.release()
cv2.destroyAllWindows()

