import { commonFixtures } from "./fixtures.mjs";
import { fixtures } from "./operations-fixtures.mjs";

const data: Record<string, unknown> = { ...commonFixtures, ...fixtures };
const proxy = (path: string[] = []): unknown =>
	new Proxy(() => {}, {
		get(_target, property: string) {
			const route = path.join(".");
			if (property === "queryOptions")
				return (input: unknown) => ({
					queryKey: [route, input],
					queryFn: async () => {
						if (new URLSearchParams(location.search).get("state") === "error")
							throw new Error("Synthetic offline state");
						if (!(route in data)) throw new Error(`No UI fixture for ${route}`);
						return data[route];
					},
					retry: false,
				});
			if (property === "pathKey") return () => [route];
			if (property === "mutationOptions")
				return (options: object = {}) => ({
					...options,
					mutationFn: async () => {
						throw new Error(
							"Read-only UI preview: business actions are disabled.",
						);
					},
				});
			return proxy([...path, property]);
		},
	});
const trpc = proxy();
export const useTRPC = () => trpc;
