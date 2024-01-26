
export type BoundingBox = [number, number, number, number];
export interface FrigateEventData {
    box: BoundingBox,
    region: BoundingBox,
    score: number,
    top_score: number,
}

export interface FrigateEvent {
    id: string,
    timestamp: Date,
    start_time: number,
    end_time: number,
    zones: string[],
    data: FrigateEventData
}

// const codeToStatus = {
//     '614110001': 'open' as const,
//     '614110002': 'inProgress' as const,
//     '614110000': 'cancel' as const,
//     '614110003': 'closed' as const,
// }

export const statusToCode = {
    open: '614110001' as const,
    inProgress: '614110002' as const,
    cancel: '614110000' as const,
    closed: '614110003' as const,
}

export interface ServiceRequest {
    serviceRequestNumber: string,
    incidentDate: string,
    incidentDateTime: string,
}

export interface ServiceRequestStatus {
    SRNumber: string,
    Agency: string,
    Problem: string,
    ProblemDetails: string,
    ResolutionActionUpdatedDate: string,
    Status: string,
    DateTimeSubmitted: string,
    ResolutionAction: string,
    Address: {
        Borough: string,
        FullAddress: string
    }
}

export interface SubmissionRun {
    lastRunTime: string
}

export interface ReviewStatus {
    totalReviews: number,
}

export interface EventState {
    event: FrigateEvent,
    serviceRequest?: ServiceRequest,
    hasResolution: boolean,
    serviceRequestStatus?: ServiceRequestStatus,
}

export interface EventDatabase {
    events: Map<FrigateEvent['id'], EventState>,
}

export interface ServiceRequestDefinition {
    zoneNames: string[],
    address: string,
    problemDescription: string
}