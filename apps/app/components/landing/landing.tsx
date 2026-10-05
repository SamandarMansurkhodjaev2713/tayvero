import { AgentSection } from "./agent-section";
import { LandingAnalytics } from "./analytics";
import { CapabilitiesSection } from "./capabilities-section";
import { ClosingCta } from "./closing-cta";
import { LandingFaq } from "./faq";
import { Hero } from "./hero";
import { LandingFooter } from "./landing-footer";
import { LandingNav } from "./landing-nav";
import { ProductShot } from "./product-shot/product-shot";
import "./landing.css";

export function TayveroLanding() {
	return (
		<div className="tayvero-landing" lang="ru">
			<a className="tayvero-landing-skip" href="#landing-main">
				Перейти к содержимому
			</a>
			<LandingNav />
			<main id="landing-main">
				<Hero />
				<ProductShot />
				<CapabilitiesSection />
				<AgentSection />
				<LandingFaq />
				<ClosingCta />
			</main>
			<LandingFooter />
			<LandingAnalytics />
		</div>
	);
}
