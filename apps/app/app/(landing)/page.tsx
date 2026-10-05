import type { Metadata } from "next";
import { TayveroLanding } from "@/components/landing/landing";

export const metadata: Metadata = {
	title: { absolute: "Tayvero — CRM и управляемый AI для вашей команды" },
	description:
		"Клиенты, сделки и AI-агенты в одном рабочем пространстве. Открытая CRM с контролем действий, историей результатов и кодом под MIT.",
	openGraph: {
		title: "Tayvero — бизнес в контексте",
		description:
			"Клиенты, сделки и управляемый AI. Открытый код. Ваше рабочее пространство.",
		locale: "ru_RU",
		type: "website",
		images: [
			{
				url: "/landing/tayvero-workspace-light.jpg",
				alt: "Tayvero — превью компонентов рабочего пространства на демонстрационных данных",
			},
		],
	},
};

export default function Home() {
	return <TayveroLanding />;
}
