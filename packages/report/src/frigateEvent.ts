import path from "path";

export const eventBasePath = process.env.EVENTS_BASE_PATH!;
export const clipStagingBasePath = process.env.EVENT_STAGING_BASE_PATH!;

if (eventBasePath.trim() === clipStagingBasePath.trim()) {
    throw new Error('EVENTS_BASE_PATH and EVENT_STAGING_BASE_PATH cannot be the same');
}

export const CLIP_S3_BUCKET = "311-sidewalk";

export function createEventPaths(eventId: string) {
    const eventPath = path.join(eventBasePath, eventId);
    const eventStagingPath = path.join(clipStagingBasePath, eventId);
    return {
        eventPath,
        eventStagingPath,
        shotsPath: path.join(eventPath, 'shots'),
        serviceRequestJsonPath: path.join(eventPath, 'SR.json'),
        serviceRequestResolutionJsonPath: path.join(eventPath, 'resolution.json'),
        frigateClipJson: path.join(eventPath, 'event.json'),
        clipPath: path.join(eventPath, 'sidewalk_rider_clip.mp4'),
        clipStagingPath: path.join(eventStagingPath, 'sidewalk_rider_clip.mp4'),
        clipReviewStatusPath: path.join(eventStagingPath, 'review.json'),
        clipPathInBrowserlessContainer: `/data/events/${eventId}/sidewalk_rider_clip.mp4`,
        s3ObjectKey: `${eventId}/sidewalk_rider_clip.mp4`,
        s3Url: `https://${CLIP_S3_BUCKET}.s3.amazonaws.com/${eventId}/sidewalk_rider_clip.mp4`,
    }
}

export type FrigateEventPaths = ReturnType<typeof createEventPaths>;

const pathCache = new Map<string, FrigateEventPaths>();
export function getEventPaths(eventId: string) {
    if (pathCache.has(eventId)) {
        return pathCache.get(eventId)!;
    }
    const paths = createEventPaths(eventId);
    pathCache.set(eventId, paths);
    return paths;
}
