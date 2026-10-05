import { Button } from "@crm/ui/components/button";
import Link from "next/link";
import { Wordmark } from "./wordmark";

export function LandingNav() {
	return (
		<header className="tayvero-landing-nav">
			<nav className="tayvero-landing-width" aria-label="Главная навигация">
				<Link href="/" aria-label="Tayvero — главная">
					<Wordmark />
				</Link>
				<div className="tayvero-landing-nav-links">
					<a href="#capabilities">Возможности</a>
					<a href="#control">Контроль AI</a>
					<a href="#questions">Вопросы</a>
				</div>
				<Button variant="outline" asChild>
					<Link href="/sign-in">Войти в CRM</Link>
				</Button>
			</nav>
		</header>
	);
}
