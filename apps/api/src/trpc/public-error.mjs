/** Never expose database errors, credentials or a server stack as a user-facing toast. */
export function publicErrorMessage(code, message) {
    const fallback = 'We could not confirm this operation. Refresh the record before trying again.';
    if (['INTERNAL_SERVER_ERROR', 'UNKNOWN', 'BAD_GATEWAY', 'SERVICE_UNAVAILABLE', 'TIMEOUT', 'GATEWAY_TIMEOUT'].includes(code))
        return fallback;
    if (typeof message !== 'string' || !message.trim())
        return 'The request could not be completed.';
    if (/Prisma|SQLSTATE|postgres(?:ql)?:\/\/|Authorization\s*:|Bearer\s+[A-Za-z0-9._-]+|\bSELECT\b[\s\S]*\bFROM\b|(?:api[_-]?key|secret|password|token)\s*[=:]\s*\S+/i.test(message))
        return fallback;
    return message.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500);
}
