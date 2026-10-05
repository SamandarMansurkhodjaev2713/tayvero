"use client";

import Building from "@carbon/icons-react/es/Building";
import Chat from "@carbon/icons-react/es/Chat";
import Close from "@carbon/icons-react/es/Close";
import Dashboard from "@carbon/icons-react/es/Dashboard";
import Partnership from "@carbon/icons-react/es/Partnership";
import Settings from "@carbon/icons-react/es/Settings";
import TaskApproved from "@carbon/icons-react/es/TaskApproved";
import UserMultiple from "@carbon/icons-react/es/UserMultiple";
import { Button } from "@crm/ui/components/button";
import type { CarbonIcon } from "@crm/ui/components/icon";
import { Icon } from "@crm/ui/components/icon";
import Bot from "@crm/ui/components/icons/bot";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@crm/ui/components/sheet";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@crm/ui/components/tooltip";
import { cn } from "@crm/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { AgentBuilderSidebar } from "@/components/agent-builder/agent-builder-sidebar";
import { usePrefetchSection } from "@/components/crm/section-prefetch";
import { useMobileNav } from "@/components/mobile-nav";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

type RailItem = {
	title: string;
	href: string;
	icon: CarbonIcon;
	iconClassName?: string;
	match: "exact" | "prefix";
	related?: string[];
	group: "Workspace" | "CRM" | "Automation" | "Administration";
};

const ITEMS: RailItem[] = [
	{
		title: "Overview",
		href: "/",
		icon: Dashboard,
		match: "exact",
		group: "Workspace",
	},
	{
		title: "Deals",
		href: "/deals",
		icon: Partnership,
		match: "prefix",
		group: "CRM",
	},
	{
		title: "Contacts",
		href: "/contacts",
		icon: UserMultiple,
		match: "prefix",
		group: "CRM",
	},
	{
		title: "Companies",
		href: "/companies",
		icon: Building,
		match: "prefix",
		group: "CRM",
	},
	{
		title: "Agents",
		href: "/agents",
		icon: Bot,
		match: "prefix",
		group: "Automation",
	},
	{
		title: "Operations",
		href: "/operations",
		icon: TaskApproved,
		match: "prefix",
		group: "Automation",
	},
	{
		title: "Chat",
		href: "/chat",
		icon: Chat,
		match: "prefix",
		group: "Automation",
	},
	{
		title: "Settings",
		href: "/settings",
		icon: Settings,
		match: "prefix",
		group: "Administration",
	},
];

const GROUPS = ["Workspace", "CRM", "Automation"] as const;

function isActive(item: RailItem, pathname: string): boolean {
	return (
		pathname === item.href ||
		(item.match === "prefix" && pathname.startsWith(`${item.href}/`)) ||
		Boolean(
			item.related?.some(
				(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
			),
		)
	);
}

function RailLink({
	item,
	active,
	onPrefetch,
}: {
	item: RailItem;
	active: boolean;
	onPrefetch: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					asChild
					variant="ghost"
					size="icon"
					className={cn(
						"nav-item text-muted-foreground",
						active &&
							"bg-muted text-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					<Link
						href={item.href}
						prefetch
						onMouseEnter={onPrefetch}
						onFocus={onPrefetch}
						aria-current={active ? "page" : undefined}
						transitionTypes={["nav-lateral"]}
					>
						<Icon icon={item.icon} className={item.iconClassName} />
						<span className="nav-item-label">{item.title}</span>
					</Link>
				</Button>
			</TooltipTrigger>
			<TooltipContent side="right">{item.title}</TooltipContent>
		</Tooltip>
	);
}

function MobileRailLink({
	item,
	active,
	onNavigate,
	onPrefetch,
}: {
	item: RailItem;
	active: boolean;
	onNavigate: () => void;
	onPrefetch: () => void;
}) {
	return (
		<Button
			asChild
			variant="ghost"
			className={cn(
				"justify-start gap-3 text-muted-foreground",
				active &&
					"bg-muted text-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Link
				href={item.href}
				prefetch
				onMouseEnter={onPrefetch}
				onFocus={onPrefetch}
				aria-current={active ? "page" : undefined}
				onClick={onNavigate}
				transitionTypes={[
					item.title === "Chat" ? "nav-forward" : "nav-lateral",
				]}
			>
				<Icon icon={item.icon} className={item.iconClassName} />
				<span>{item.title}</span>
			</Link>
		</Button>
	);
}

function MobileRailIconLink({
	item,
	active,
	onNavigate,
	onPrefetch,
}: {
	item: RailItem;
	active: boolean;
	onNavigate: () => void;
	onPrefetch: () => void;
}) {
	return (
		<Button
			asChild
			variant="ghost"
			size="icon"
			className={cn(
				"text-muted-foreground",
				active &&
					"bg-muted text-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Link
				href={item.href}
				prefetch
				onMouseEnter={onPrefetch}
				onFocus={onPrefetch}
				aria-current={active ? "page" : undefined}
				onClick={onNavigate}
			>
				<Icon icon={item.icon} className={item.iconClassName} />
				<span className="sr-only">{item.title}</span>
			</Link>
		</Button>
	);
}

export function AppIconRailFallback() {
	return (
		<nav
			data-slot="app-navigation"
			aria-label="Primary"
			aria-busy="true"
			className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r py-3 md:flex [view-transition-name:app-rail]"
		>
			{ITEMS.map((item) => (
				<Button
					key={item.href}
					variant="ghost"
					size="icon"
					disabled
					className="nav-item text-muted-foreground"
				>
					<Icon icon={item.icon} className={item.iconClassName} />
					<span className="nav-item-label">{item.title}</span>
				</Button>
			))}
		</nav>
	);
}

export function AppIconRail() {
	const pathname = usePathname();
	const workspaceUrl = useWorkspaceUrl();
	const { open, setOpen } = useMobileNav();
	const prefetchSection = usePrefetchSection();

	const items = useMemo(
		() =>
			ITEMS.map((item) => ({
				...item,
				section: item.href,
				href: workspaceUrl(item.href),
				related: item.related?.map((path) => workspaceUrl(path)),
			})),
		[workspaceUrl],
	);
	const inChat = items.some(
		(item) =>
			(item.title === "Chat" || item.title === "Agents") &&
			isActive(item, pathname),
	);

	return (
		<>
			<nav
				data-slot="app-navigation"
				aria-label="Primary"
				className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r py-3 md:flex [view-transition-name:app-rail]"
			>
				{GROUPS.map((group) => (
					<div className="nav-group" key={group}>
						<span className="nav-group-label">{group}</span>
						{items
							.filter((item) => item.group === group)
							.map((item) => (
								<RailLink
									key={item.href}
									item={item}
									active={isActive(item, pathname)}
									onPrefetch={() => prefetchSection(item.section)}
								/>
							))}
					</div>
				))}
				<div className="nav-footer">
					{items
						.filter((item) => item.group === "Administration")
						.map((item) => (
							<RailLink
								key={item.href}
								item={item}
								active={isActive(item, pathname)}
								onPrefetch={() => prefetchSection(item.section)}
							/>
						))}
					<p className="nav-caption">
						TAYVERO
						<br />
						Your business, in context.
					</p>
				</div>
			</nav>

			<Sheet open={open} onOpenChange={setOpen}>
				{inChat ? (
					<SheetContent
						side="left"
						showCloseButton={false}
						className="w-5/6 max-w-sm flex-row gap-0 p-0"
					>
						<SheetHeader className="sr-only">
							<SheetTitle>Navigation and agent chats</SheetTitle>
						</SheetHeader>
						<nav
							aria-label="Primary"
							className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3"
						>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Close navigation"
								onClick={() => setOpen(false)}
							>
								<Icon icon={Close} />
							</Button>
							<div className="my-1 h-px w-5 bg-border" />
							{items.map((item) => (
								<MobileRailIconLink
									key={item.href}
									item={item}
									active={isActive(item, pathname)}
									onNavigate={() => setOpen(false)}
									onPrefetch={() => prefetchSection(item.section)}
								/>
							))}
						</nav>
						<AgentBuilderSidebar
							className="flex flex-1"
							onNavigate={() => setOpen(false)}
						/>
					</SheetContent>
				) : (
					<SheetContent side="left" className="w-64 gap-0 p-0">
						<SheetHeader>
							<SheetTitle>Navigation</SheetTitle>
						</SheetHeader>
						<nav
							aria-label="Primary"
							className="flex flex-1 flex-col gap-1 p-2"
						>
							{items.map((item) => (
								<MobileRailLink
									key={item.href}
									item={item}
									active={isActive(item, pathname)}
									onNavigate={() => setOpen(false)}
									onPrefetch={() => prefetchSection(item.section)}
								/>
							))}
						</nav>
					</SheetContent>
				)}
			</Sheet>
		</>
	);
}
