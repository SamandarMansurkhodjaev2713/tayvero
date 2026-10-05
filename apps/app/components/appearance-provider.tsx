"use client";

import {
	APPEARANCE_STORAGE_KEY,
	type Appearance,
	applyAppearance,
	DEFAULT_APPEARANCE,
	normalizeAppearance,
	parseAppearance,
} from "@crm/ui/theme/appearance";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

type AppearanceContextValue = {
	appearance: Appearance;
	ready: boolean;
	persisted: boolean;
	update: (patch: Partial<Omit<Appearance, "version">>) => void;
	reset: () => void;
};

const Context = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
	const [appearance, setAppearance] = useState<Appearance>({
		...DEFAULT_APPEARANCE,
	});
	const current = useRef<Appearance>({ ...DEFAULT_APPEARANCE });
	const [ready, setReady] = useState(false);
	const [persisted, setPersisted] = useState(true);

	useEffect(() => {
		let initial: Appearance = { ...DEFAULT_APPEARANCE };
		try {
			initial = parseAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY));
		} catch {
			setPersisted(false);
		}
		applyAppearance(document.documentElement, initial);
		current.current = initial;
		setAppearance(initial);
		setReady(true);

		const sync = (event: StorageEvent) => {
			if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== null) return;
			try {
				if (event.storageArea !== localStorage) return;
			} catch {
				return;
			}
			const next = parseAppearance(event.newValue);
			applyAppearance(document.documentElement, next);
			current.current = next;
			setAppearance(next);
		};
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, []);

	const save = useCallback((next: Appearance) => {
		applyAppearance(document.documentElement, next);
		current.current = next;
		setAppearance(next);
		try {
			localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
			setPersisted(true);
		} catch {
			setPersisted(false);
		}
	}, []);

	const update = useCallback(
		(patch: Partial<Omit<Appearance, "version">>) => {
			// Compose successive updates against the latest value, even before a render.
			save(normalizeAppearance({ ...current.current, ...patch, version: 1 }));
		},
		[save],
	);
	const reset = useCallback(() => save({ ...DEFAULT_APPEARANCE }), [save]);

	return (
		<Context.Provider value={{ appearance, ready, persisted, update, reset }}>
			{children}
		</Context.Provider>
	);
}

export function useAppearance() {
	const context = useContext(Context);
	if (!context) throw new Error("useAppearance requires AppearanceProvider");
	return context;
}
