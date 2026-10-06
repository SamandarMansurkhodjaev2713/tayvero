import Logo from "@crm/ui/components/logo";
import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ children }: { children: ReactNode }) {
	return (
		<main className="dark grid min-h-svh bg-background text-foreground lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
			<section className="relative hidden min-h-svh overflow-hidden bg-muted p-8 lg:flex lg:flex-col lg:justify-between xl:p-12">
				<div className="relative flex gap-2 text-sm/5">
					<Link href="/" aria-label="Homepage" className="flex">
						<Logo className="size-5 shrink-0" />
						<span className="ml-3 font-semibold tracking-tight">Tayvero</span>
					</Link>
				</div>

				<div className="relative flex max-w-lg flex-col gap-8">
					<div className="flex flex-col gap-4">
						<p className="max-w-[15ch] text-5xl/14 font-semibold tracking-tight text-balance">
							A clear next step for every customer.
						</p>
						<p className="max-w-sm text-base/7 text-muted-foreground">
							Keep the relationship, the deal and the work together. Give your
							team a shared place to move forward.
						</p>
					</div>
					<ol className="divide-y divide-border border-y border-border">
						{[
							["Know the customer", "Contacts and company history"],
							["Choose the next step", "Deals, notes and follow-up tasks"],
							["Delegate with context", "Agents, permissions and run history"],
						].map(([title, description], index) => (
							<li key={title} className="flex items-start gap-5 py-5">
								<span
									aria-hidden="true"
									className="pt-0.5 text-sm text-muted-foreground"
								>
									{index + 1}
								</span>
								<div className="flex flex-col gap-1">
									<p className="text-sm font-medium">{title}</p>
									<p className="text-sm text-muted-foreground">{description}</p>
								</div>
							</li>
						))}
					</ol>
				</div>

				<p className="relative text-xs/5 text-muted-foreground">
					Open source. Built by{" "}
					<a
						href="https://github.com/SamandarMansurkhodjaev2713/tayvero"
						target="_blank"
						rel="noreferrer"
						className="underline underline-offset-4 hover:text-foreground"
					>
						Samandar Mansurkhodjaev
					</a>
				</p>
			</section>

			<section className="flex min-h-svh flex-col bg-background px-6 py-8 sm:px-10 lg:px-14">
				<div className="flex gap-2 text-sm/5 max-lg:hidden lg:invisible">
					<Logo className="size-5 shrink-0" />
				</div>

				<div className="flex flex-1 items-center justify-center py-12">
					<div className="flex w-full max-w-sm flex-col gap-8">{children}</div>
				</div>
			</section>
		</main>
	);
}

export function AuthHeading({
	title,
	description,
}: {
	title: string;
	description: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 text-left">
			<Link href="/" aria-label="Homepage" className="flex">
				<Logo className="size-6 shrink-0" />
			</Link>
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl/8 font-semibold tracking-tight text-balance">
					{title}
				</h1>
				<p className="max-w-[32ch] text-sm/5 text-muted-foreground text-pretty">
					{description}
				</p>
			</div>
		</div>
	);
}
