import { createGovernedActionExecutor } from "@crm/agent-action-runtime";
import { createAgentActionExecutionServiceCore } from "./governed-action-service-core.mjs";

export function createAgentActionExecutionService(dependencies) {
	return createAgentActionExecutionServiceCore(
		dependencies,
		createGovernedActionExecutor,
	);
}
