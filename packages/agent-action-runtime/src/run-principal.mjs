/** The immutable version author is NOT necessarily the principal that started a scheduled run.
 * principalId is recorded by trusted dispatch. Historical scheduled runs fall back to the
 * agent creator, matching the pre-existing dispatch contract. Never accept an input actor ID.
 */
export function boundRunPrincipal(run, agent) {
	const id = (value) =>
		typeof value === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(value)
			? value
			: null;
	const persisted = id(run?.principalId),
		initiated = id(run?.initiatedById);
	if ((run?.principalId && !persisted) || (run?.initiatedById && !initiated))
		return null;
	if (persisted && initiated && persisted !== initiated) return null;
	return persisted ?? initiated ?? id(agent?.createdById);
}
