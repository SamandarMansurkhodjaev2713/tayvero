export function deploymentActionPolicy(
	environment?: Record<string, string | undefined>,
): (request: {
	manifest: { id: string; risk: string; mutating: boolean };
}) => Readonly<{ allowed: boolean; requiresApproval: boolean; reason: string }>;
