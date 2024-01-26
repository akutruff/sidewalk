import { getEventPaths } from './frigateEvent.js';
import { writeFileAsJson, readFileAsJson } from './serialization.js';
import type { ReviewStatus } from './types.js';

if (!process.env.MINIMUM_REQUIRED_REVIEWS == null) {
    throw new Error('MINIMUM_REQUIRED_REVIEWS not set');
}

export const minimumRequiredReviews = Math.max(2, Number.parseInt(process.env.MINIMUM_REQUIRED_REVIEWS!));

export async function incrementReviewStatus(eventId: string, newTotalReviews: number) {
    const paths = getEventPaths(eventId);
    const reviewStatus = await loadReviewStatus(eventId) ?? { totalReviews: 0 }

    if (newTotalReviews <= minimumRequiredReviews && (reviewStatus.totalReviews + 1) === newTotalReviews) {
        reviewStatus.totalReviews = newTotalReviews;
        await writeFileAsJson(paths.clipReviewStatusPath, reviewStatus);
    }
}

export async function loadReviewStatus(eventId: string) {
    const paths = getEventPaths(eventId);
    try {
        return await readFileAsJson<ReviewStatus>(paths.clipReviewStatusPath);
    } catch {
        return undefined;
    }
}

export function hasClipBeenReviewedEnough(reviewStatus?: ReviewStatus) {
    return reviewStatus && reviewStatus?.totalReviews >= minimumRequiredReviews;
}
