export function runRetryPolicy(run: {
    status: string;
    errorCode?: string | null;
    actions?: {
        status: string;
        attemptCount: number;
        externalId?: string | null;
    }[];
    actionsTruncated?: boolean;
}): {
    allowed: boolean;
    code: string | null;
    reason: string | null;
};
