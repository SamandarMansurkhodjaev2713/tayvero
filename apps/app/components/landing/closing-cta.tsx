import { GitHubStarButton } from "./github-star-button";
import { SetupPromptButton } from "./setup-prompt-button";

export function ClosingCta() {
	return (
		<section
			className="tayvero-landing-closing tayvero-landing-width"
			aria-labelledby="closing-title"
		>
			<h2 id="closing-title">
				Ваши процессы.
				<br />
				Ваше рабочее пространство.
			</h2>
			<div>
				<p>
					Изучите код, запустите Tayvero локально и помогите улучшить следующий
					рабочий сценарий.
				</p>
				<div className="tayvero-landing-actions">
					<GitHubStarButton location="closing" />
					<SetupPromptButton location="closing" />
				</div>
			</div>
		</section>
	);
}
