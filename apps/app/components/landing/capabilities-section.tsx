import ArrowRight from "@carbon/icons-react/es/ArrowRight";
import { REPO_URL } from "./links";

const CAPABILITIES = [
	{
		title: "От клиента до следующего шага.",
		body: "Контакты, компании, сделки и история активности рядом. Смотрите воронку, разбирайте состояние сделки и возвращайтесь к конкретному контексту.",
		detail: "CRM · Сделки · История",
	},
	{
		title: "От задачи до управляемого агента.",
		body: "Задайте цель, проверьте разрешённые действия и следите за запусками. Последний результат, стоимость и статус помогают понять, где нужно ваше внимание.",
		detail: "Агенты · Результаты · Подтверждения",
	},
	{
		title: "От таблицы до проверяемого импорта.",
		body: "Подготовьте CSV или TSV, проверьте соответствие полей и результаты обработки. Контакты и компании переносятся небольшими пакетами, с отчётом по каждой строке.",
		detail: "Предпросмотр · Проверка полей · История",
	},
] as const;

export function CapabilitiesSection() {
	return (
		<section
			id="capabilities"
			className="tayvero-landing-section tayvero-landing-width"
			aria-labelledby="capabilities-title"
		>
			<div className="tayvero-landing-section-intro">
				<h2 id="capabilities-title">
					Всё связано.
					<br />
					Всё видно.
				</h2>
				<p>
					Отдельные инструменты хранят кусочки работы. Tayvero собирает контекст
					клиента, движение сделки и действия команды в одном месте.
				</p>
			</div>
			<div className="tayvero-landing-capabilities">
				{CAPABILITIES.map((item) => (
					<article key={item.title}>
						<h3>{item.title}</h3>
						<div>
							<p>{item.body}</p>
							<span>{item.detail}</span>
						</div>
					</article>
				))}
			</div>
			<div className="tayvero-landing-local">
				<p>
					<strong>С учётом Узбекистана.</strong> Нормализация местных телефонов
					в импорте. Русский, узбекский и английский для операционных экранов.
				</p>
				<a
					href={`${REPO_URL}/blob/main/README.md`}
					target="_blank"
					rel="noopener noreferrer"
				>
					Возможности и ограничения
					<ArrowRight aria-hidden="true" />
				</a>
			</div>
		</section>
	);
}
