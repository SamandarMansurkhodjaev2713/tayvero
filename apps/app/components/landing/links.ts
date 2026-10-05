export const REPO_URL = "https://github.com/SamandarMansurkhodjaev2713/tayvero";

export const REPO_LINKS = [
	{ label: "Исходный код", href: REPO_URL },
	{ label: "Предложить улучшение", href: `${REPO_URL}/issues` },
	{
		label: "Как запустить",
		href: `${REPO_URL}/blob/main/README.md#запустить-локально`,
	},
	{ label: "Лицензия MIT", href: `${REPO_URL}/blob/main/LICENSE` },
] as const;
