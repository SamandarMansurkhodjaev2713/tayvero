"use client";
import { useSyncExternalStore } from "react";
import {
	OPERATIONS_CATALOG,
	type OperationsLocale,
	operationsLocale,
} from "./operations-catalog.mjs";

const KEY = "tayvero.operations.locale.v1";
const EVENT = "tayvero:operations-locale";
let memory: OperationsLocale = "en";
function snapshot() {
	try {
		return operationsLocale(window.localStorage.getItem(KEY) ?? memory);
	} catch {
		return memory;
	}
}
function subscribe(callback: () => void) {
	window.addEventListener(EVENT, callback);
	window.addEventListener("storage", callback);
	return () => {
		window.removeEventListener(EVENT, callback);
		window.removeEventListener("storage", callback);
	};
}
export function useOperationsLocale() {
	const locale = useSyncExternalStore(
		subscribe,
		snapshot,
		() => "en" as OperationsLocale,
	);
	const setLocale = (value: string) => {
		memory = operationsLocale(value);
		try {
			window.localStorage.setItem(KEY, memory);
		} catch {
			/* Session-only preference when storage is disabled. */
		}
		window.dispatchEvent(new Event(EVENT));
	};
	return { locale, setLocale, text: OPERATIONS_CATALOG[locale] };
}
export function OperationsLanguage() {
	const { locale, setLocale, text } = useOperationsLocale();
	return (
		<label className="flex items-center gap-2 text-sm text-muted-foreground">
			{text.language}
			<select
				className="rounded-md border bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
				value={locale}
				onChange={(event) => setLocale(event.target.value)}
			>
				<option value="en">English</option>
				<option value="ru">Русский</option>
				<option value="uz">O‘zbekcha</option>
			</select>
		</label>
	);
}
