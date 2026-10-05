/** Shared, dependency-free appearance contracts. Only whitelisted values reach the DOM. */
export const APPEARANCE_STORAGE_KEY = "tayvero.appearance.v1";
export const DEFAULT_APPEARANCE = Object.freeze({
	version: 1,
	palette: "graphite",
	density: "comfortable",
	navigation: "expanded",
});
export const PALETTES = Object.freeze([
	Object.freeze({
		id: "graphite",
		name: "Graphite",
		description: "Clear neutrals with a precise blue accent.",
	}),
	Object.freeze({
		id: "grove",
		name: "Grove",
		description: "Quiet green tones for a calmer workspace.",
	}),
	Object.freeze({
		id: "sand",
		name: "Sand",
		description: "Warm surfaces with a restrained clay accent.",
	}),
	Object.freeze({
		id: "indigo",
		name: "Indigo",
		description: "Cool ink tones with a subtle violet accent.",
	}),
]);
// Semantic colours, not a collection of per-screen overrides. Every palette has equal capabilities.
const bases = {
	graphite: {
		light: [
			"#f6f7f9",
			"#ffffff",
			"#192433",
			"#566273",
			"#eef1f5",
			"#e7edf6",
			"#2557a7",
			"#ffffff",
			"#dce2e9",
			"#7c8898",
		],
		dark: [
			"#11161e",
			"#19212d",
			"#edf2f8",
			"#adb9cb",
			"#222d3c",
			"#2c3a50",
			"#99bbff",
			"#14233f",
			"#344355",
			"#72849d",
		],
	},
	grove: {
		light: [
			"#f5f8f6",
			"#ffffff",
			"#1b2c26",
			"#53685d",
			"#ecf2ee",
			"#dfece5",
			"#246348",
			"#ffffff",
			"#d8e3dc",
			"#768b7e",
		],
		dark: [
			"#111b17",
			"#19271f",
			"#edf5ee",
			"#acbfb1",
			"#24352b",
			"#2a4234",
			"#99d1ac",
			"#152c1e",
			"#354c3d",
			"#70917d",
		],
	},
	sand: {
		light: [
			"#faf7f2",
			"#fffdf9",
			"#302820",
			"#6d5e50",
			"#f0eae1",
			"#eae0d4",
			"#955132",
			"#ffffff",
			"#e1d8cc",
			"#958373",
		],
		dark: [
			"#1c1814",
			"#28211a",
			"#f6eee3",
			"#c4b49f",
			"#362c22",
			"#463628",
			"#e8b58d",
			"#322014",
			"#514234",
			"#a38b70",
		],
	},
	indigo: {
		light: [
			"#f7f7fc",
			"#ffffff",
			"#28243b",
			"#635e79",
			"#eeedf6",
			"#e5e2f3",
			"#6550a5",
			"#ffffff",
			"#dfdbea",
			"#8b83a2",
		],
		dark: [
			"#181621",
			"#23202f",
			"#f1eef9",
			"#b9b0cd",
			"#302c40",
			"#3c3453",
			"#c1b0f5",
			"#241a40",
			"#494158",
			"#9283ae",
		],
	},
};
function tokens(values, mode) {
	const [
		background,
		card,
		foreground,
		subtle,
		muted,
		accent,
		primary,
		onPrimary,
		border,
		input,
	] = values;
	const dark = mode === "dark";
	return Object.freeze({
		background,
		foreground,
		card,
		"card-foreground": foreground,
		popover: card,
		"popover-foreground": foreground,
		primary,
		"primary-foreground": onPrimary,
		secondary: muted,
		"secondary-foreground": foreground,
		muted,
		"muted-foreground": subtle,
		accent,
		"accent-foreground": foreground,
		tag: card,
		"tag-foreground": foreground,
		border,
		input,
		ring: primary,
		sidebar: card,
		"sidebar-foreground": foreground,
		"sidebar-primary": primary,
		"sidebar-primary-foreground": onPrimary,
		"sidebar-accent": accent,
		"sidebar-accent-foreground": foreground,
		"sidebar-border": border,
		"sidebar-ring": primary,
		destructive: dark ? "#ffafa7" : "#ad302a",
		"destructive-foreground": dark ? "#451a17" : "#ffffff",
		success: dark ? "#9cdab6" : "#216944",
		"success-foreground": dark ? "#142d20" : "#ffffff",
		warning: dark ? "#f1cb82" : "#80521b",
		"warning-foreground": dark ? "#382810" : "#ffffff",
		info: dark ? "#a6caff" : "#24599a",
		"info-foreground": dark ? "#152a49" : "#ffffff",
		"code-foreground": foreground,
		"code-string": primary,
		"code-accent": dark ? "#ffbe9b" : "#934521",
		"chart-1": primary,
		"chart-2": dark ? "#90cfb0" : "#287454",
		"chart-3": dark ? "#dfba82" : "#885d22",
		"chart-4": dark ? "#c4b1f4" : "#7657b1",
		"chart-5": dark ? "#86c7d6" : "#286d83",
		"severity-critical": dark ? "#ffafa7" : "#ad302a",
		"severity-high": dark ? "#ffbd91" : "#995326",
		"severity-medium": dark ? "#f1cb82" : "#80521b",
		"severity-low": subtle,
		"severity-info": subtle,
		"severity-unknown": subtle,
	});
}
export const THEME_TOKENS = Object.freeze(
	Object.fromEntries(
		Object.entries(bases).map(([id, modes]) => [
			id,
			Object.freeze(
				Object.fromEntries(
					Object.entries(modes).map(([mode, colors]) => [
						mode,
						tokens(colors, mode),
					]),
				),
			),
		]),
	),
);
export function normalizeAppearance(value) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		value.version !== 1
	)
		return { ...DEFAULT_APPEARANCE };
	return {
		version: 1,
		palette: PALETTES.some((p) => p.id === value.palette)
			? value.palette
			: DEFAULT_APPEARANCE.palette,
		density: ["comfortable", "compact"].includes(value.density)
			? value.density
			: DEFAULT_APPEARANCE.density,
		navigation: ["expanded", "compact"].includes(value.navigation)
			? value.navigation
			: DEFAULT_APPEARANCE.navigation,
	};
}
export function parseAppearance(raw) {
	if (typeof raw !== "string" || raw.length > 2048)
		return { ...DEFAULT_APPEARANCE };
	try {
		return normalizeAppearance(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_APPEARANCE };
	}
}
export function applyAppearance(root, value) {
	const safe = normalizeAppearance(value);
	root.dataset.palette = safe.palette;
	root.dataset.density = safe.density;
	root.dataset.navigation = safe.navigation;
	return safe;
}
// Constant, versioned bootstrap: no user HTML is interpolated. Storage denial must never prevent rendering.
export const APPEARANCE_BOOTSTRAP = `(()=>{let v;try{v=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)})||"null")}catch{};if(!v||v.version!==1)v={};const d=document.documentElement.dataset;d.palette=${JSON.stringify(PALETTES.map((p) => p.id))}.includes(v.palette)?v.palette:"graphite";d.density=v.density==="compact"?"compact":"comfortable";d.navigation=v.navigation==="compact"?"compact":"expanded"})()`;
export function generateAppearanceCss() {
	return (
		Object.entries(THEME_TOKENS)
			.flatMap(([palette, modes]) =>
				Object.entries(modes).map(([mode, vars]) => {
					const selector = `:root${mode === "dark" ? ".dark" : ":not(.dark)"}[data-palette="${palette}"]`;
					const fallback =
						palette === "graphite"
							? `,\n:root${mode === "dark" ? ".dark" : ":not(.dark)"}:not([data-palette])`
							: "";
					return `${selector}${fallback} {\n\tcolor-scheme: ${mode};\n${Object.entries(
						vars,
					)
						.map(([key, val]) => `\t--${key}: ${val};`)
						.join("\n")}\n}`;
				}),
			)
			.join("\n\n") + "\n"
	);
}
