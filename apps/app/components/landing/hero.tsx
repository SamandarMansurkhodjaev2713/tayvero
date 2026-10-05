import ArrowDown from "@carbon/icons-react/es/ArrowDown";
import { GitHubStarButton } from "./github-star-button";
import { SetupPromptButton } from "./setup-prompt-button";

export function Hero() {
	return (
		<section
			className="tayvero-landing-hero tayvero-landing-width"
			aria-labelledby="landing-title"
		>
			<div className="tayvero-landing-hero-grid">
				<div>
					<h1 id="landing-title">
						Бизнес —<br />в контексте<span>.</span>
					</h1>
					<p className="tayvero-landing-hero-copy">
						Клиенты, сделки и AI-агенты в одном рабочем пространстве. Чтобы
						видеть следующий шаг — и контролировать, как он выполнен.
					</p>
					<div className="tayvero-landing-actions">
						<GitHubStarButton location="hero" />
						<SetupPromptButton location="hero" />
					</div>
					<p className="tayvero-landing-hero-note">
						Открытый код · MIT · Развёртывание в своём окружении
					</p>
				</div>
				<aside
					className="tayvero-landing-principles"
					aria-label="Принципы Tayvero"
				>
					<p>
						У работы есть контекст.
						<br />У AI есть границы.
						<br />У действия есть история.
					</p>
					<a href="#product">
						Посмотреть рабочее пространство
						<ArrowDown aria-hidden="true" />
					</a>
				</aside>
			</div>
		</section>
	);
}
