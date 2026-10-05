export function mayDecideApproval(row, decision, now = Date.now()) {
    if (!row || row.legacyUnbound || !Number.isSafeInteger(row.version) || row.version < 0 || !Number.isFinite(now))
        return false;
    if (!Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= now)
        return false;
    if (decision === "APPROVED")
        return row.status === "PENDING" && row.canApprove === true && row.snapshot?.previewComplete === true;
    if (decision === "REJECTED")
        return row.status === "PENDING" && row.canReject === true;
    if (decision === "CANCELLED")
        return ["PENDING", "APPROVED"].includes(row.status) && row.canCancel === true;
    return false;
}
export function approvalDecisionPayload(row, decision, reason = "", now = Date.now()) {
    if (!mayDecideApproval(row, decision, now) || typeof reason !== "string" || reason.length > 500)
        throw new Error("Approval decision requires a current complete server snapshot");
    return { approvalId: row.id, expectedVersion: row.version, expectedDigest: row.payloadDigest, decision, reason };
}
