/** Local-only rendering harness. It mounts production components with synthetic read-only query fixtures.
 * Run: bun tools/quality/ui-preview/build.mjs [--serve]
 * This is not authenticated application acceptance and is never included in app routes.
 */
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const app = path.join(root, "apps/app");
const out = path.join(root, ".scratch/design-preview");
await mkdir(out, { recursive: true });
const virtual = {
	"next/image": `import React from 'react'; export default function Image({priority,fill,unoptimized,...props}) { return <img {...props} />; }`,
	"@crm/telemetry/project": `export const POSTHOG_HOST='https://example.test'; export const POSTHOG_KEY='preview-disabled'; export const POSTHOG_UI_HOST='https://example.test';`,
	"next/link": `import React from 'react'; export default function Link({children,transitionTypes,prefetch,...props}) { return <a {...props}>{children}</a>; }`,
	"next/navigation": `export function useParams(){return {slug:'demo'}}; export function usePathname(){return location.pathname}; export function useRouter(){return {push:p=>location.assign(p),replace:p=>location.replace(p),refresh:()=>location.reload(),back:()=>history.back()}};`,
	"@/components/page-transition": `export function PageTransition({children}){return children;}`,
	"@/components/agent-builder/agent-builder-sidebar": `export function AgentBuilderSidebar(){return null;}`,
	"@/components/enrichment-queue": `export function EnrichmentQueue(){return null;}`,
	"@/lib/sign-out": `export async function signOutAndRedirect(){throw new Error('Read-only component preview');}`,
	"@/components/dashboard-charts": `export {AreaTrend,DonutStat} from '@crm/ui/components/dashboard-chart';`,
};
await esbuild({
	entryPoints: [path.join(root, "tools/quality/ui-preview/preview.tsx")],
	outfile: path.join(out, "app.js"),
	platform: "browser",
	format: "esm",
	bundle: true,
	jsx: "automatic",
	minify: false,
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
		"process.env.NEXT_PUBLIC_LANDING_ANALYTICS_ENABLED":
			JSON.stringify("false"),
		"process.env.NEXT_PUBLIC_POSTHOG_KEY": JSON.stringify(""),
		"process.env.NEXT_PUBLIC_POSTHOG_HOST": JSON.stringify(
			"https://example.test",
		),
	},
	plugins: [
		{
			name: "isolated-ui-fixtures",
			setup(build) {
				build.onResolve({ filter: /page-transition$/ }, () => ({
					path: "@/components/page-transition",
					namespace: "fixture",
				}));
				build.onResolve(
					{
						filter:
							/^(next\/(link|navigation|image)|@\/|@crm\/telemetry\/project$)/,
					},
					(args) => {
						if (args.path in virtual)
							return { path: args.path, namespace: "fixture" };
						if (args.path === "@/lib/trpc/client")
							return {
								path: path
									.join(root, "tools/quality/ui-preview/mock-trpc.ts")
									.replaceAll("\\", "/"),
							};
						if (args.path.startsWith("@/")) {
							return {
								path: Bun.resolveSync(
									path.join(app, args.path.slice(2)),
									app,
								).replaceAll("\\", "/"),
							};
						}
					},
				);
				build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
					contents: virtual[args.path],
					loader: "tsx",
				}));
				build.onResolve({ filter: /^[^./]/ }, (args) => {
					if (
						args.namespace === "fixture" ||
						args.importer.includes("ui-preview")
					) {
						try {
							return {
								path: Bun.resolveSync(args.path, app).replaceAll("\\", "/"),
							};
						} catch {}
					}
				});
			},
		},
	],
});
const pluginPath = Bun.resolveSync("@tailwindcss/postcss", app);
const { default: postcss } = await import(
	Bun.resolveSync("postcss", path.dirname(pluginPath))
);
const { default: tailwind } = await import(pluginPath);
const cssPath = path.join(root, "packages/ui/src/styles/globals.css");
const css = await postcss([tailwind({ base: root })]).process(
	(await readFile(cssPath, "utf8")) +
		'\n@source "../../../tools/quality/ui-preview/**/*.{ts,tsx}";\n',
	{ from: cssPath },
);
// Use exactly the app's generated Geist faces when a native Next compile has produced them.
let fontCss = "";
try {
	const chunks = path.join(app, ".next/static/chunks");
	for (const name of await readdir(chunks)) {
		if (!name.endsWith(".css")) continue;
		const text = await readFile(path.join(chunks, name), "utf8");
		const faces =
			text.match(/@font-face\{[^}]*font-family:Geist[^}]*\}/g) || [];
		fontCss += faces.join("\n").replaceAll("../media/", "/fonts/");
	}
	await mkdir(path.join(out, "fonts"), { recursive: true });
	for (const match of fontCss.matchAll(/\/fonts\/([A-Za-z0-9_.-]+\.woff2)/g)) {
		await copyFile(
			path.join(app, ".next/static/media", match[1]),
			path.join(out, "fonts", match[1]),
		);
	}
} catch {
	/* A clean checkout can still inspect layout with a declared font fallback. */
}
const landingCss = await readFile(
	path.join(app, "components/landing/landing.css"),
	"utf8",
);
await writeFile(
	path.join(out, "app.css"),
	fontCss +
		'\n:root { --font-geist-sans: Geist, sans-serif; --font-geist-mono: "Geist Mono", monospace; }\n' +
		css.css +
		"\n" +
		landingCss,
);
await writeFile(
	path.join(out, "index.html"),
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tayvero · Component preview</title><link rel="stylesheet" href="/app.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column;font-family:Geist,Arial,sans-serif}.preview-note{flex-shrink:0;padding:5px 16px;font-size:11px;text-align:center;background:var(--muted);color:var(--muted-foreground);border-bottom:1px solid var(--border)}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`,
);
console.log(
	"Built production-component UI fixtures. Synthetic data; mutations disabled.",
);
if (process.argv.includes("--serve")) {
	Bun.serve({
		hostname: "127.0.0.1",
		port: 4317,
		fetch(request) {
			const url = new URL(request.url);
			if (/^\/landing\/tayvero-workspace-(light|dark)\.jpg$/.test(url.pathname))
				return new Response(
					Bun.file(path.join(app, "public", url.pathname.slice(1))),
					{
						headers: {
							"content-type": "image/jpeg",
							"cache-control": "no-store",
						},
					},
				);
			const font = /^\/fonts\/[A-Za-z0-9_.-]+\.woff2$/.test(url.pathname);
			const name = font
				? url.pathname.slice(1)
				: url.pathname === "/app.js"
					? "app.js"
					: url.pathname === "/app.css"
						? "app.css"
						: "index.html";
			return new Response(Bun.file(path.join(out, name)), {
				headers: {
					"content-type": font
						? "font/woff2"
						: name.endsWith("js")
							? "application/javascript"
							: name.endsWith("css")
								? "text/css"
								: "text/html",
					"cache-control": "no-store",
				},
			});
		},
	});
	console.log("Preview: http://127.0.0.1:4317/demo");
}
