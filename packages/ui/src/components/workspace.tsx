import type { ComponentProps, ReactNode } from "react";
import { cn } from "@crm/ui/lib/utils";

/** Shared operating surfaces. Colours always follow the selected appearance. */
export function WorkspaceMetrics({
	children,
	label,
}: {
	children: ReactNode;
	label?: string;
}) {
	return (
		<dl className="workspace-metrics" aria-label={label}>
			{children}
		</dl>
	);
}

export function WorkspaceMetric({
	label,
	value,
	detail,
	tone = "default",
}: {
	label: ReactNode;
	value: ReactNode;
	detail?: ReactNode;
	tone?: "default" | "warning";
}) {
	return (
		<div className="workspace-metric" data-tone={tone}>
			<dt>{label}</dt>
			<dd>
				{value}
				{detail && <p>{detail}</p>}
			</dd>
		</div>
	);
}

export function WorkspacePanel({
	title,
	description,
	action,
	children,
	className,
	...props
}: Omit<ComponentProps<"section">, "title"> & {
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
}) {
	return (
		<section className={cn("workspace-panel", className)} {...props}>
			<header className="workspace-panel-header">
				<div>
					<h2>{title}</h2>
					{description && <p>{description}</p>}
				</div>
				{action && <div className="workspace-panel-action">{action}</div>}
			</header>
			<div className="workspace-panel-body">{children}</div>
		</section>
	);
}

export function WorkspaceNotice({
	tone = "info",
	className,
	...props
}: ComponentProps<"div"> & { tone?: "info" | "warning" | "danger" }) {
	return (
		<div
			className={cn("workspace-notice", className)}
			data-tone={tone}
			{...props}
		/>
	);
}

export function WorkspaceToolbar({
	className,
	...props
}: ComponentProps<"div">) {
	return <div className={cn("workspace-toolbar", className)} {...props} />;
}

export function WorkspaceStatus({
	tone = "neutral",
	className,
	...props
}: ComponentProps<"span"> & {
	tone?: "neutral" | "success" | "warning" | "danger";
}) {
	return (
		<span
			className={cn("workspace-status", className)}
			data-tone={tone}
			{...props}
		/>
	);
}
