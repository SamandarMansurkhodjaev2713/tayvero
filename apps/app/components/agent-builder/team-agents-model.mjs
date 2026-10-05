/** UI summaries of visible agent rows, not a global run/approval/ROI ledger. */
export const TEAM_VIEWS = Object.freeze(['current', 'all', 'live', 'paused', 'review', 'archived']);
export function latestRunNeedsReview(agent) { return agent.status !== 'ARCHIVED' && ['FAILED', 'WAITING_FOR_APPROVAL'].includes(agent.lastRun?.status); }
export function summarizeTeamAgents(rows) {
    return Object.freeze({ visible: rows.length, live: rows.filter(a => a.status === 'LIVE').length, paused: rows.filter(a => a.status === 'PAUSED').length, needsReview: rows.filter(latestRunNeedsReview).length, latestRunCoverage: rows.filter(a => Object.hasOwn(a, 'lastRun')).length });
}
export function filterTeamAgents(rows, { query = '', view = 'current' } = {}) {
    const needle = String(query).trim().toLocaleLowerCase('en-US').slice(0, 200);
    const selected = TEAM_VIEWS.includes(view) ? view : 'current';
    return rows.filter(agent => {
        if (selected === 'current' && agent.status === 'ARCHIVED')
            return false;
        if (selected === 'review' && !latestRunNeedsReview(agent))
            return false;
        if (['live', 'paused', 'archived'].includes(selected) && agent.status !== selected.toUpperCase())
            return false;
        return !needle || `${agent.name}\n${agent.description ?? ''}`.toLocaleLowerCase('en-US').includes(needle);
    });
}
export function displayRunCost(value) {
    if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value) || value.length > 20)
        return 'Not recorded';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(value));
}
