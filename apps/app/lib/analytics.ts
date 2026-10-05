export const ANALYTICS_HOSTS: readonly string[] = [
	"product.example",
	"www.product.example",
];

export function analyticsAllowed(hostname: string): boolean {
	return ANALYTICS_HOSTS.includes(hostname.trim().toLowerCase());
}
