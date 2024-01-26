#!/bin/bash

rsync -az --progress --omit-dir-times --exclude 'desktop.ini' --exclude '.tmp.driveupload' nas:/volume1/Downloads/311-events/events/ /mnt/d/311-events/events/