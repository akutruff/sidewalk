
EVENTS_PATH="./events"
DELETED_FILE_DIRECTORY="./deleted"

sudo chown -R andyk:andyk "$EVENTS_PATH"
sudo chown -R andyk:andyk "$DELETED_FILE_DIRECTORY"

rm -r $EVENTS_PATH/*
rm -r $DELETED_FILE_DIRECTORY/*