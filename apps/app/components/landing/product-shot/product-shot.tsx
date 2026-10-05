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
						src="/landing/tayvero-workspace-light.jpg"
						alt="Рабочее пространство Tayvero: обзор сделок, графики и следующие шаги на демонстрационных данных"
						width={2560}
						height={1777}
						sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1440px) 92vw, 1280px"
						priority
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
