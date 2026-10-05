import { REPO_LINKS } from "./links";
import { Wordmark } from "./wordmark";

export function LandingFooter() {
	return (
		<footer className="tayvero-landing-footer">
			<div className="tayvero-landing-width">
				<div>
					<Wordmark />
					<p>
						Клиенты, сделки и управляемый AI.
						<br />
						Открытый код для вашего рабочего пространства.
					</p>
				</div>
				<nav aria-label="Ресурсы проекта">
					{REPO_LINKS.map((link) => (
						<a
							key={link.label}
							href={link.href}
							target="_blank"
							rel="noopener noreferrer"
						>
							{link.label}
						</a>
					))}
				</nav>
			</div>
			<div className="tayvero-landing-width tayvero-landing-footer-bottom">
				<p>© 2026 Samandar Mansurkhodjaev</p>
				<p>MIT License · Активная разработка</p>
			</div>
		</footer>
	);
}
