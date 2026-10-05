/** Component/token browser fixture, NOT a running authenticated Next.js application. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	APPEARANCE_BOOTSTRAP,
	generateAppearanceCss,
	PALETTES,
	THEME_TOKENS,
} from "../../packages/ui/src/theme/appearance.mjs";

const source = await readFile(
	new URL("../../packages/ui/src/styles/globals.css", import.meta.url),
	"utf8",
);
const ergonomics = source
	.split("/* Product ergonomics:")[1]
	.split("/* GENERATED APPEARANCE TOKENS")[0];
const css = generateAppearanceCss() + "\n/* Product ergonomics:" + ergonomics;
const out = path.resolve(process.argv[2] ?? "appearance-preview.html");
const icon = (id) =>
	`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${{ overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', deals: '<path d="M4 6h16v14H4zM8 6V3h8v3M4 12h16M10 12v3h4v-3"/>', contacts: '<circle cx="10" cy="8" r="3"/><path d="M4 21v-3a6 6 0 0 1 12 0v3m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 2 5"/>', companies: '<path d="M4 21V3h11v18m0-12h5v12M8 7h3M8 11h3M8 15h3M8 19h3"/>', agents: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M12 7V3M9 16h6M7 11v2M17 11v2"/>', chat: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0zM7 10h10M7 14h7"/>', settings: '<path d="m10 3 4 0 1 3 3-1 2 3-2 3 2 3-2 3-3-1-1 3h-4l-1-3-3 1-2-3 2-3-2-3 2-3 3 1z"/><circle cx="12" cy="11" r="3"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>' }[id]}</svg>`;
const paletteLabels = PALETTES.map(
	(p) =>
		`<label class="appearance-choice"><input type="radio" name="palette" value="${p.id}"><span class="appearance-swatch" data-swatch="${p.id}" aria-hidden="true"></span><span class="appearance-choice-title">${p.name}</span><span class="appearance-hint">${p.description}</span></label>`,
).join("");
const rows = [
	[
		"Samarqand Retail",
		"Annual supply agreement",
		"Contract sent",
		"UZS 84,000,000",
		"Follow up · today",
		"SR",
	],
	[
		"Atlas Logistics",
		"Branch expansion",
		"Qualified to buy",
		"UZS 46,500,000",
		"Meeting · 15 Sep",
		"AL",
	],
	[
		"Navruz Studio",
		"Service package",
		"Demo booked",
		"UZS 12,000,000",
		"Confirm requirements",
		"NS",
	],
	[
		"Orzu Coffee",
		"Equipment renewal",
		"Decision maker bought in",
		"UZS 28,000,000",
		"Prepare proposal",
		"OC",
	],
];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tayvero · Appearance preview</title><style>${css}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--background);color:var(--foreground)}button,input,select{font:inherit}button,a,label{touch-action:manipulation}button{cursor:pointer}a{color:inherit;text-decoration:none}svg{flex-shrink:0}.topbar{height:64px;border-bottom:1px solid var(--border);display:flex;gap:18px;align-items:center;padding:0 24px;background:var(--card)}.brand{font-size:18px;font-weight:700;letter-spacing:-.6px;display:flex;align-items:center;gap:10px}.brand-mark{height:27px;width:27px;background:var(--primary);color:var(--primary-foreground);border-radius:7px;display:grid;place-items:center;font-size:19px}.workspace-name{border-left:1px solid var(--border);padding-left:18px;font-size:13px;color:var(--muted-foreground)}.search-button{margin-left:auto;display:flex;gap:10px;align-items:center;padding:7px 12px;background:var(--background);border:1px solid var(--input);color:var(--muted-foreground);border-radius:7px;font-size:12px}.search-button kbd{margin-left:35px;font:11px inherit}.avatar{border-radius:100%;background:var(--accent);color:var(--accent-foreground);width:30px;height:30px;display:grid;place-items:center;font-size:11px;font-weight:600}.shell{display:flex;min-height:calc(100vh - 64px)}[data-slot=app-navigation]{display:flex;width:56px;flex-shrink:0;flex-direction:column;align-items:center;gap:5px;border-right:1px solid var(--border);padding-top:20px}[data-slot=app-navigation] .nav-item{display:flex;align-items:center;justify-content:center;font-size:13px;border-radius:7px;background:transparent;border:0;color:var(--muted-foreground);height:40px}.nav-foot{margin-top:36px}.workspace{flex:1;min-width:0;padding:30px 38px 50px;max-width:1600px;margin:auto}.eyebrow{text-transform:uppercase;font-size:10px;letter-spacing:1.5px;font-weight:650;color:var(--muted-foreground)}h1{margin:6px 0 5px;font-size:28px;line-height:1.25;font-weight:620;letter-spacing:-.9px}.subtitle{margin:0;color:var(--muted-foreground);font-size:13px}.page-head{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.button{min-height:36px;padding:8px 13px;display:inline-flex;align-items:center;justify-content:center;gap:7px;background:var(--primary);color:var(--primary-foreground);border:1px solid transparent;border-radius:7px;font-size:12px;font-weight:550}.button.secondary{background:var(--card);border-color:var(--input);color:var(--foreground)}.preview-note{display:flex;gap:12px;align-items:center;border:1px solid var(--border);border-radius:8px;background:var(--card);padding:10px 14px;font-size:12px;color:var(--muted-foreground);margin-bottom:22px}.preview-note strong{color:var(--foreground);font-size:11px;letter-spacing:.2px;white-space:nowrap}.stats{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--border);border-radius:10px;background:var(--card);margin:0 0 24px;padding:18px 0}.stat{padding:0 20px;border-right:1px solid var(--border)}.stat:last-child{border:0}.stat p{margin:0;font-size:12px;color:var(--muted-foreground)}.stat strong{font-size:23px;font-weight:600;letter-spacing:-.6px;display:block;margin:4px 0}.stat small{font-size:11px;color:var(--muted-foreground)}.table-panel{border:1px solid var(--border);border-radius:10px;background:var(--card);overflow:hidden;margin-bottom:30px}.table-bar{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)}.table-bar strong{font-size:13px;font-weight:600}.table-scroll{overflow-x:auto}table{border-collapse:collapse;min-width:780px;width:100%}th{text-align:left;padding:0 18px;font-size:11px;font-weight:550;background:var(--muted);color:var(--muted-foreground)}td{padding:12px 18px;border-bottom:1px solid var(--border);vertical-align:middle}tr:last-child td{border-bottom:0}.cell-title{display:block;font-weight:550}.cell-sub{font-size:11px;color:var(--muted-foreground)}.stage{font-size:11px;white-space:nowrap;display:inline-flex;align-items:center;gap:7px}.stage::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--primary)}.money{font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}.section-title{font-size:18px;letter-spacing:-.3px;font-weight:600;margin:0 0 4px}.appearance-container{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:24px;margin-top:18px}.appearance-settings{max-width:none}.appearance-swatch{margin-top:18px}.appearance-section{margin-bottom:20px;padding-bottom:20px}.options-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}.options-grid .appearance-section{margin:0}.appearance-option-row{gap:8px}.appearance-option{padding:10px 12px;font-size:12px}.appearance-footer{margin-top:20px}.tabular{font-variant-numeric:tabular-nums}dialog{border:1px solid var(--border);background:var(--popover);color:var(--foreground);border-radius:12px;padding:24px;max-width:480px;width:90%}dialog::backdrop{background:rgb(0 0 0/.35)}
@media(max-width:1099px){.workspace{padding:24px}.workspace-name{display:none}.appearance-palette-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.topbar{height:56px;padding:0 16px;gap:12px}.brand{font-size:16px}.search-button{padding:6px}.search-button span,.search-button kbd{display:none}[data-slot=app-navigation]{display:none}.workspace{padding:22px 16px}.page-head{align-items:flex-start;flex-direction:column;gap:14px}h1{font-size:26px}.stats{grid-template-columns:1fr}.stat{border:0;border-bottom:1px solid var(--border);padding:10px 18px}.stat:first-child{padding-top:0}.stat:last-child{padding-bottom:0}.stat strong{font-size:20px}.stat small{display:none}.preview-note{align-items:flex-start;flex-direction:column;gap:2px}.appearance-container{padding:18px}.options-grid{grid-template-columns:1fr}.appearance-palette-grid{gap:10px}.appearance-option{min-height:44px}.table-bar{gap:10px}.appearance-choice{padding:10px}.appearance-choice>.appearance-hint{font-size:11px}.appearance-swatch{height:76px}}
</style><script>${APPEARANCE_BOOTSTRAP};try{const m=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))}catch{}</script></head><body><a href="#content" class="skip-to-content">Skip to content</a><header class="topbar"><a class="brand" href="#content"><span class="brand-mark" aria-hidden="true">t</span>Tayvero</a><span class="workspace-name">Demo workspace</span><button type="button" class="search-button" id="search-button" aria-label="Search preview">${icon("search")}<span>Search workspace</span><kbd>Ctrl K</kbd></button><span class="avatar" role="img" aria-label="Demo user">SM</span></header><div class="shell"><nav data-slot="app-navigation" aria-label="Primary">${[
	["overview", "Overview"],
	["deals", "Deals"],
	["contacts", "Contacts"],
	["companies", "Companies"],
	["agents", "Agents"],
	["chat", "Chat"],
	["settings", "Appearance"],
]
	.map(
		([id, name]) =>
			`<a class="nav-item ${id === "settings" ? "nav-foot" : ""}" href="${id === "settings" ? "#appearance" : "#content"}" ${id === "deals" ? 'aria-current="page"' : ""} aria-label="${name}">${icon(id)}<span class="nav-item-label">${name}</span></a>`,
	)
	.join(
		"",
	)}</nav><main id="content" class="workspace" tabindex="-1"><div class="page-head"><div><span class="eyebrow">Sales workspace</span><h1>Know what needs your attention.</h1><p class="subtitle">Your deals, next steps and priorities. One quiet place to work.</p></div><a href="#appearance" class="button">Customise appearance <span aria-hidden="true">↗</span></a></div><aside class="preview-note"><strong>DESIGN FIXTURE</strong><span>Synthetic records. This preview uses repository theme tokens and ergonomics CSS; it is not the authenticated CRM.</span></aside><section class="stats" aria-label="Example summary"><div class="stat"><p>Open opportunities</p><strong class="tabular">4</strong><small>Example records shown below</small></div><div class="stat"><p>Pipeline · UZS</p><strong class="tabular">170,500,000</strong><small>Illustrative amounts, one currency</small></div><div class="stat"><p>Follow-up due today</p><strong class="tabular">1</strong><small>Review the next step, not just the stage</small></div></section><section class="table-panel"><div class="table-bar"><strong>Active deals <span class="cell-sub"> / 4</span></strong><span class="cell-sub">Table density follows your preference</span></div><div class="table-scroll"><table data-slot="table"><caption style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Synthetic deals to preview palette, typography and table density</caption><thead><tr>${["Company / Deal", "Stage", "Amount", "Next step"].map((x) => `<th scope="col" data-slot="table-head">${x}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr data-slot="table-row"><td data-slot="table-cell"><span class="cell-title">${r[0]}</span><span class="cell-sub">${r[1]}</span></td><td data-slot="table-cell"><span class="stage">${r[2]}</span></td><td data-slot="table-cell" class="money">${r[3]}</td><td data-slot="table-cell"><span class="cell-sub">${r[4]}</span></td></tr>`).join("")}</tbody></table></div></section><section id="appearance"><h2 class="section-title">Make it yours.</h2><p class="subtitle">The same workspace. A different feel.</p><div class="appearance-container"><div class="appearance-settings"><fieldset class="appearance-section"><legend class="appearance-legend">Colour palette</legend><p class="appearance-hint">Each palette has matching light and dark surfaces.</p><div class="appearance-palette-grid">${paletteLabels}</div></fieldset><div class="options-grid"><fieldset class="appearance-section"><legend class="appearance-legend">Display mode</legend><div class="appearance-option-row">${["system", "light", "dark"].map((x) => `<label class="appearance-option"><input type="radio" name="mode" value="${x}"><span>${x[0].toUpperCase() + x.slice(1)}</span></label>`).join("")}</div></fieldset><fieldset class="appearance-section"><legend class="appearance-legend">Table density</legend><div class="appearance-option-row">${["comfortable", "compact"].map((x) => `<label class="appearance-option"><input type="radio" name="density" value="${x}"><span>${x[0].toUpperCase() + x.slice(1)}</span></label>`).join("")}</div></fieldset></div><fieldset class="appearance-section" style="margin-top:22px"><legend class="appearance-legend">Navigation on wide screens</legend><div class="appearance-option-row">${[
	["expanded", "Icons and labels"],
	["compact", "Icons only"],
]
	.map(
		([x, t]) =>
			`<label class="appearance-option"><input type="radio" name="navigation" value="${x}"><span>${t}</span></label>`,
	)
	.join(
		"",
	)}</div></fieldset><footer class="appearance-footer"><p class="appearance-hint" role="status" id="saved-status">Preferences are saved in this browser.</p><button type="button" class="button secondary" id="reset">Reset appearance</button></footer></div></div></section></main></div><dialog id="preview-search"><h2 class="section-title">Search in the CRM</h2><p class="appearance-hint">The real application searches authorised records. This standalone fixture does not connect to your database.</p><button type="button" class="button" id="close-search" style="margin-top:18px">Close</button></dialog><script>
const tokens=${JSON.stringify(THEME_TOKENS)};const root=document.documentElement;const system=matchMedia('(prefers-color-scheme: dark)');let mode='system';try{mode=['light','dark'].includes(localStorage.getItem('theme'))?localStorage.getItem('theme'):'system'}catch{};
function paint(){root.classList.toggle('dark',mode==='dark'||mode==='system'&&system.matches);document.querySelectorAll('input[type=radio]').forEach(input=>{input.checked=input.name==='mode'?input.value===mode:input.value===root.dataset[input.name]});document.querySelectorAll('[data-swatch]').forEach(el=>{const t=tokens[el.dataset.swatch][root.classList.contains('dark')?'dark':'light'];el.style.background=t.background;el.style.borderColor=t.border;el.innerHTML='<span class="appearance-swatch-nav" style="background:'+t.card+';border-color:'+t.border+'"><i style="background:'+t.primary+'"></i><i style="background:'+t.border+'"></i><i style="background:'+t.border+'"></i></span><span class="appearance-swatch-body"><i style="background:'+t.foreground+'"></i><i style="background:'+t.muted+'"></i><i style="background:'+t.muted+'"></i><b style="background:'+t.primary+';color:'+t['primary-foreground']+'">Aa</b></span>'})}
function save(){try{localStorage.setItem('tayvero.appearance.v1',JSON.stringify({version:1,palette:root.dataset.palette,density:root.dataset.density,navigation:root.dataset.navigation}));localStorage.setItem('theme',mode)}catch{document.querySelector('#saved-status').textContent='Storage unavailable. Changes apply for this session.'}paint()}
document.querySelectorAll('input[type=radio]').forEach(input=>{input.addEventListener('change',()=>{if(input.name==='mode')mode=input.value;else root.dataset[input.name]=input.value;save()})});document.querySelector('#reset').onclick=()=>{root.dataset.palette='graphite';root.dataset.density='comfortable';root.dataset.navigation='expanded';mode='system';save()};system.addEventListener('change',paint);paint();const dialog=document.querySelector('#preview-search');document.querySelector('#search-button').onclick=()=>dialog.showModal();document.querySelector('#close-search').onclick=()=>dialog.close();document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(dialog.open)dialog.close();else dialog.showModal()}});
</script></body></html>`;
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, html);
console.log(out);
