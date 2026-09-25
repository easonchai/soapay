import { Hero } from './sections/Hero.js';
import { About } from './sections/About.js';
import { Featured } from './sections/Featured.js';
import { Philosophy } from './sections/Philosophy.js';
import { Cards } from './sections/Cards.js';
import { Footer } from './sections/Footer.js';

export function App() {
  return (
    <>
      <Hero />
      <About />
      <Featured />
      <Philosophy />
      <Cards />
      <Footer />
    </>
  );
}
