import ChevronDown from "@carbon/icons-react/es/ChevronDown";
import { REPO_URL } from "./links";

const QUESTIONS = [
	{
		title: "Что нужно, чтобы начать?",
		text: "Bun 1.3.12, Node.js 22+, PostgreSQL и настроенный способ входа через Google или Microsoft. Порядок установки и список переменных есть в README. Промпт для запуска можно передать своему coding agent.",
	},
	{
		title: "Можно развернуть Tayvero у себя?",
		text: "Да, исходный код доступен по MIT. Текущая архитектура предполагает отдельное развёртывание для рабочего пространства. Использование общей базы нескольких независимых клиентов пока не является готовым SaaS-сценарием.",
	},
	{
		title: "Какие подключения есть в коде?",
		text: "Google, Microsoft и Slack. Они требуют OAuth-настроек, разрешений и проверок провайдера. Telegram, WhatsApp, 1C, единый Inbox и полная локализация всего продукта остаются направлением разработки.",
	},
	{
		title: "Это уже production-ready продукт?",
		text: "Проект активно развивается. Полная готовность не подтверждена: нужны проверки сборки, PostgreSQL, авторизованных сценариев, провайдеров и восстановления. Скриншот выше — превью компонентов с демонстрационными данными, а не подтверждение работы production-сессии.",
	},
] as const;

export function LandingFaq() {
	return (
		<section
			id="questions"
			className="tayvero-landing-section tayvero-landing-width tayvero-landing-faq"
			aria-labelledby="questions-title"
		>
			<div>
				<h2 id="questions-title">
					Перед первым
					<br />
					запуском.
				</h2>
				<p>Что уже можно изучить и что ещё нужно проверить.</p>
				<a
					href={`${REPO_URL}/blob/main/README.md`}
					target="_blank"
					rel="noopener noreferrer"
				>
					Читать документацию
				</a>
			</div>
			<div>
				{QUESTIONS.map((item) => (
					<details key={item.title}>
						<summary>
							{item.title}
							<ChevronDown aria-hidden="true" />
						</summary>
						<p>{item.text}</p>
					</details>
				))}
			</div>
		</section>
	);
}
