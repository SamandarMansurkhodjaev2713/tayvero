import ArrowUpRight from "@carbon/icons-react/es/ArrowUpRight";
import { REPO_URL } from "./links";

const ACTION_FLOW = [
	{
		title: "Контекст",
		text: "Агент работает с разрешёнными данными и конкретной задачей.",
	},
	{
		title: "Политика",
		text: "Сервер проверяет полномочия. Значимые действия требуют подтверждения по правилам.",
	},
	{
		title: "Исполнение",
		text: "Durable receipt и ограниченные повторы помогают контролировать повторное выполнение.",
	},
	{
		title: "История",
		text: "Результат, статус и аудит позволяют вернуться к тому, что произошло.",
	},
] as const;

export function AgentSection() {
	return (
		<section
			id="control"
			className="tayvero-landing-control"
			aria-labelledby="control-title"
		>
			<div className="tayvero-landing-width">
				<div className="tayvero-landing-control-intro">
					<h2 id="control-title">
						AI помогает.
						<br />
						Вы держите контроль.
					</h2>
					<div>
						<p>
							Не каждое предложенное действие должно сразу стать выполненным.
							Между моделью и бизнесом нужны понятные правила.
						</p>
						<a
							href={`${REPO_URL}/blob/main/agents.md`}
							target="_blank"
							rel="noopener noreferrer"
						>
							Как устроено управление действиями
							<ArrowUpRight aria-hidden="true" />
						</a>
					</div>
				</div>
				<ol className="tayvero-landing-control-flow">
					{ACTION_FLOW.map((item) => (
						<li key={item.title}>
							<h3>{item.title}</h3>
							<p>{item.text}</p>
						</li>
					))}
				</ol>
				<p className="tayvero-landing-control-note">
					Механизмы реализованы в коде. Интеграция с БД и провайдерами требует
					release gates; новые write / continuation функции выключены по
					умолчанию.
				</p>
			</div>
		</section>
	);
}
