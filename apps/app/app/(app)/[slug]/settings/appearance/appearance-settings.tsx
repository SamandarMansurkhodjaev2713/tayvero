"use client";

import { Button } from "@crm/ui/components/button";
import { PALETTES, THEME_TOKENS } from "@crm/ui/theme/appearance";
import { useTheme } from "next-themes";
import { useAppearance } from "@/components/appearance-provider";

export function AppearanceSettings() {
	const { appearance, ready, persisted, update, reset } = useAppearance();
	const { theme, resolvedTheme, setTheme } = useTheme();
	const mode = resolvedTheme === "dark" ? "dark" : "light";
	return (
		<div className="appearance-settings" aria-busy={!ready}>
			<fieldset disabled={!ready} className="appearance-section">
				<legend className="appearance-legend">Colour palette</legend>
				<p className="appearance-hint">
					Four complete palettes, each with its own light and dark surfaces.
				</p>
				<div className="appearance-palette-grid">
					{PALETTES.map((palette) => {
						const t = THEME_TOKENS[palette.id][mode];
						return (
							<label key={palette.id} className="appearance-choice">
								<input
									type="radio"
									name="palette"
									value={palette.id}
									checked={appearance.palette === palette.id}
									onChange={() => update({ palette: palette.id })}
								/>
								<span
									className="appearance-swatch"
									aria-hidden="true"
									style={{ background: t.background, borderColor: t.border }}
								>
									<span
										className="appearance-swatch-nav"
										style={{ background: t.card, borderColor: t.border }}
									>
										<i style={{ background: t.primary }} />
										<i style={{ background: t.border }} />
										<i style={{ background: t.border }} />
									</span>
									<span className="appearance-swatch-body">
										<i style={{ background: t.foreground }} />
										<i style={{ background: t.muted }} />
										<i style={{ background: t.muted }} />
										<b
											style={{
												background: t.primary,
												color: t["primary-foreground"],
											}}
										>
											Aa
										</b>
									</span>
								</span>
								<span className="appearance-choice-title">{palette.name}</span>
								<span className="appearance-hint">{palette.description}</span>
							</label>
						);
					})}
				</div>
			</fieldset>
			<fieldset disabled={!ready} className="appearance-section">
				<legend className="appearance-legend">Display mode</legend>
				<p className="appearance-hint">
					System follows your device, including scheduled dark mode.
				</p>
				<div className="appearance-option-row">
					{(
						[
							["system", "System"],
							["light", "Light"],
							["dark", "Dark"],
						] as const
					).map(([id, label]) => (
						<label key={id} className="appearance-option">
							<input
								type="radio"
								name="display-mode"
								value={id}
								checked={ready && theme === id}
								onChange={() => setTheme(id)}
							/>
							<span>{label}</span>
						</label>
					))}
				</div>
			</fieldset>
			<fieldset disabled={!ready} className="appearance-section">
				<legend className="appearance-legend">Table density</legend>
				<p className="appearance-hint">
					Comfortable gives records room to breathe. Compact fits more rows on
					screen.
				</p>
				<div className="appearance-option-row">
					{(["comfortable", "compact"] as const).map((id) => (
						<label key={id} className="appearance-option">
							<input
								type="radio"
								name="density"
								checked={appearance.density === id}
								onChange={() => update({ density: id })}
							/>
							<span>{id === "comfortable" ? "Comfortable" : "Compact"}</span>
						</label>
					))}
				</div>
			</fieldset>
			<fieldset disabled={!ready} className="appearance-section">
				<legend className="appearance-legend">Navigation</legend>
				<p className="appearance-hint">
					Labels stay visible on wide screens. Tablet and mobile layouts stay
					compact.
				</p>
				<div className="appearance-option-row">
					{(["expanded", "compact"] as const).map((id) => (
						<label key={id} className="appearance-option">
							<input
								type="radio"
								name="navigation"
								checked={appearance.navigation === id}
								onChange={() => update({ navigation: id })}
							/>
							<span>
								{id === "expanded" ? "Icons and labels" : "Icons only"}
							</span>
						</label>
					))}
				</div>
			</fieldset>
			<div className="appearance-footer">
				<p role="status" className="appearance-hint">
					{!ready
						? "Loading preferences…"
						: persisted
							? "Preferences are saved automatically on this device."
							: "Browser storage is unavailable. Your changes apply for this session."}
				</p>
				<Button
					variant="outline"
					disabled={!ready}
					onClick={() => {
						reset();
						setTheme("system");
					}}
				>
					Reset appearance
				</Button>
			</div>
		</div>
	);
}
