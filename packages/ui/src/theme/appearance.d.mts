export type Palette = "graphite" | "grove" | "sand" | "indigo";
export type Appearance = {
    version: 1;
    palette: Palette;
    density: "comfortable" | "compact";
    navigation: "expanded" | "compact";
};
export const APPEARANCE_STORAGE_KEY: string;
export const APPEARANCE_BOOTSTRAP: string;
export const DEFAULT_APPEARANCE: Readonly<Appearance>;
export const PALETTES: ReadonlyArray<Readonly<{
    id: Palette;
    name: string;
    description: string;
}>>;
export const THEME_TOKENS: Readonly<Record<Palette, Readonly<Record<"light" | "dark", Readonly<Record<string, string>>>>>>;
export function normalizeAppearance(value: unknown): Appearance;
export function parseAppearance(raw: unknown): Appearance;
export function applyAppearance(root: {
    dataset: {
        [key: string]: string | undefined;
    };
}, value: unknown): Appearance;
export function generateAppearanceCss(): string;
