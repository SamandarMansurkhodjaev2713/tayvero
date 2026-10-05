import Image from "next/image";

export function ProductShot() {
	return (
		<section
			id="product"
			className="tayvero-landing-product tayvero-landing-width"
			aria-label="Интерфейс Tayvero"
		>
			<figure>
				<div className="tayvero-landing-image-frame">
					<Image
						className="tayvero-landing-shot-light"
						src="/landing/tayvero-workspace-light.jpg"
						alt="Рабочее пространство Tayvero: обзор сделок, графики и следующие шаги на демонстрационных данных"
						width={1080}
						height={720}
						sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1440px) 92vw, 1280px"
						priority
					/>
					<Image
						className="tayvero-landing-shot-dark"
						src="/landing/tayvero-workspace-dark.jpg"
						alt="Тёмная тема рабочего пространства Tayvero на демонстрационных данных"
						width={1080}
						height={720}
						sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1440px) 92vw, 1280px"
					/>
				</div>
				<figcaption>
					<span>Рабочее пространство, в котором видно главное.</span>
					<span>Превью компонентов · Демонстрационные данные</span>
				</figcaption>
			</figure>
		</section>
	);
}
