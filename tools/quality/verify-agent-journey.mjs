/** Contract-backed server rendering of actual agent UI states.
 * Run with Bun from repo root. Synthetic queries only; every mutation rejects.
 * This verifies rendered state/permission guidance, not browser interaction or provider acceptance.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
const app = path.join(root, "apps/app");
const out = path.join(root, ".scratch/agent-journey-check.mjs");
await mkdir(path.dirname(out), { recursive: true });
const virtual = {
	"next/link":
		"import React from 'react'; export default function Link({children,transitionTypes,prefetch,...props}) { return <a {...props}>{children}</a>; }",
	"next/navigation":
		"export function useParams(){return {slug:'demo'}}; export function useSearchParams(){return new URLSearchParams()}; export function useRouter(){return {push(){throw new Error('Navigation disabled in SSR check')},replace(){throw new Error('Navigation disabled in SSR check')}}};",
	"@/components/page-transition":
		"export function PageTransition({children}){return children;}",
	"@/lib/trpc/client": `
const proxy=(path=[])=>new Proxy(()=>{}, {get(_,key){const route=path.join('.');if(key==='pathKey')return()=>[route];if(key==='mutationOptions')return(options={})=>({...options,mutationFn:async()=>{throw new Error('Synthetic read-only verification: mutation forbidden')}});if(key==='queryOptions')return input=>({queryKey:[route,input],queryFn:async()=>{throw new Error('SSR query must use seeded data')}});if(key==='infiniteQueryOptions')return input=>({queryKey:[route,input],initialPageParam:null,queryFn:async()=>{throw new Error('SSR query must use seeded data')}});return proxy([...path,key])}});
const trpc=proxy();export const useTRPC=()=>trpc;`,
};
const source = `
import assert from 'node:assert/strict';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TooltipProvider} from '@crm/ui/components/tooltip';
import {TeamAgentDetail} from '@/components/agent-builder/team-agent-detail';
import {AgentRuns} from '@/components/agent-builder/agent-history';
import {agentByIdOutput,agentHistoryOutput} from ${JSON.stringify(path.join(root, "apps/api/src/agent/agents.contracts.ts").replaceAll("\\", "/"))};
import {runRetryPolicy} from ${JSON.stringify(path.join(root, "apps/api/src/agent/run-retry-policy.mjs").replaceAll("\\", "/"))};
import {agentJourneyScenarios,exampleRun,retryableRun,blockedRun} from ${JSON.stringify(path.join(root, "tools/quality/ui-preview/agent-journey-fixtures.mjs").replaceAll("\\", "/"))};
let checks=0;
function verify(condition,label){assert.ok(condition,label);checks++}
function render(element,seed={}) {const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});for(const [route,data] of Object.entries(seed)){client.setQueryData([route,{id:'example-agent'}],data)}return renderToString(<QueryClientProvider client={client}><TooltipProvider>{element}</TooltipProvider></QueryClientProvider>)}
const html={};
for(const [name,{agent,runs}] of Object.entries(agentJourneyScenarios)){
 agentByIdOutput.parse(agent);agentHistoryOutput.parse(runs);
 html[name]=render(<TeamAgentDetail agentId={agent.id} initialAgent={agent} initialRuns={runs} initialActivity={[]}/>);
 verify(html[name].includes(agent.name), name+': actual detail renders');
}
verify(html.firstRun.includes('Ready for its first run'),'First run has a clear next step');
verify(html.firstRun.includes('queues real work'),'Manual run is not presented as a harmless preview');
verify(html.draftReady.includes('Review and activate'),'Ready private draft has explicit activation review');
verify(html.draftReady.includes('/demo/chat/example-conversation'),'Draft correction returns to its source conversation');
verify(!html.draftReady.includes('Advanced: instructions and files'),'Draft does not expose unavailable deployed files');
verify(html.draftPending.includes('not marked this draft ready'),'Incomplete draft explains activation block');
verify(html.member.includes('creator or a workspace administrator'),'Management responsibility follows the real contract');
verify(!html.member.includes('More agent actions'),'Ordinary member is not shown management actions');
verify(html.member.includes('Run now</'),'Readable team agent stays manually runnable by ordinary members');
verify(html.paused.includes('This agent is paused'),'Paused state explains recovery');
verify(!html.eventOnly.includes('Run now</'),'Event-only agent does not advertise manual run');
verify(html.queued.includes('A run is already in progress'),'Active run receives a current-run journey');
verify(html.waiting.includes('Waiting for an authorized reviewer'),'Waiting state names who must act without granting rights');
for(const state of ['paused','queued','waiting']) {
 const button=html[state].match(new RegExp('<button[^>]*>.*?</button>', 'gs'))?.find(markup=>markup.includes('Run now</'));
 verify(button?.includes('disabled=""'),state+': manual run control is disabled while unavailable');
}
verify(html.result.includes(exampleRun.summary),'Latest reported result appears on detail');
verify(html.result.includes('generated by the agent'),'Model report is distinguished from recorded action evidence');
const report=render(<AgentRuns runs={[exampleRun]} selectedRunId={exampleRun.id} cancelling={false} onCancel={()=>{throw new Error('Mutation forbidden')}} onRetry={()=>{throw new Error('Mutation forbidden')}}/>);
verify(report.includes(exampleRun.summary),'Selected run expands its written report');
verify(report.includes('Reported cost: $0.012'),'Reported cost stays separate from missing values');
verify(report.includes('data-local-date-kind="date-time"'),'Run timestamps use existing local time semantics');
verify(!report.includes('Run #001'),'Run identity is not a number that changes with a bounded history window');
agentHistoryOutput.parse([retryableRun,blockedRun]);
verify(runRetryPolicy(retryableRun).allowed,'Fixture with no attempted effects is actually retryable');
verify(!runRetryPolicy(blockedRun).allowed,'Completed receipt prevents whole-run retry');
const retry=render(<AgentRuns runs={[retryableRun]} cancelling={false} onCancel={()=>{}} onRetry={()=>{}}/>);
verify(retry.includes('not the latest edits'),'Allowed retry explains immutable original version');
const blocked=render(<AgentRuns runs={[blockedRun]} selectedRunId={blockedRun.id} cancelling={false} onCancel={()=>{}} onRetry={()=>{}}/>);
verify(blocked.includes('whole-run retry could duplicate it'),'Retry block is visible without a disabled-control tooltip');
verify(blocked.includes('example-task-reference'),'Expanded history exposes the recorded receipt reference');
const empty=render(<AgentRuns runs={[]} cancelling={false} onCancel={()=>{}} onRetry={()=>{}}/>);
verify(empty.includes('No runs yet'),'First-run empty state differs from no matching filter');
const missing=render(<AgentRuns runs={[]} selectedRunId="older-run-reference" cancelling={false} onCancel={()=>{}} onRetry={()=>{}}/>);
verify(missing.includes('requested run is not in this loaded history') && missing.includes('older-run-reference'),'A deep link outside the history window explains the missing reference');
verify(!missing.includes('Agent-generated report'),'An unavailable deep link does not fabricate a report');
console.log('Agent journey SSR/contract verification: '+checks+' checks passed. Synthetic rendering only; no business mutations or provider calls.');
`;
await build({
	stdin: {
		contents: source,
		loader: "tsx",
		resolveDir: app,
		sourcefile: "agent-journey-verification.tsx",
	},
	outfile: out,
	platform: "node",
	format: "esm",
	bundle: true,
	jsx: "automatic",
	define: { "process.env.NODE_ENV": JSON.stringify("development") },
	plugins: [
		{
			name: "read-only-agent-journey",
			setup(build) {
				build.onResolve({ filter: /page-transition$/ }, () => ({
					path: "@/components/page-transition",
					namespace: "fixture",
				}));
				build.onResolve(
					{ filter: /^(next\/(link|navigation)|@\/)/ },
					(args) => {
						if (args.path in virtual)
							return { path: args.path, namespace: "fixture" };
						if (args.path.startsWith("@/"))
							return {
								path: Bun.resolveSync(
									path.join(app, args.path.slice(2)),
									app,
								).replaceAll("\\", "/"),
							};
					},
				);
				build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
					contents: virtual[args.path],
					loader: "tsx",
				}));
				build.onResolve({ filter: /^[^./]/ }, (args) => {
					if (args.path.startsWith("node:"))
						return { path: args.path, external: true };
					if (args.namespace === "fixture")
						return {
							path: Bun.resolveSync(args.path, app).replaceAll("\\", "/"),
						};
				});
			},
		},
	],
});
await import(out);
