import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// The docs are served at <origin>/docs/ by scripts/serve-demo.mjs, next to the company app (/)
// and the employee app (/app/). build-demo.sh passes the public origin as SITE_ORIGIN.
const site = process.env.SITE_ORIGIN?.replace(/\/$/, "") || "https://soapay.up.railway.app";
const GITHUB = "https://github.com/easonchai/soapay";

export default defineConfig({
  site,
  base: "/docs",
  integrations: [
    starlight({
      title: "Soapay Docs",
      description: "Stealth-address payroll on Base: one name per person, every salary on a fresh address only they can open.",
      // Light and dark lockups from packages/ui (Logo.tsx), so the docs read as part of the product.
      logo: { light: "./src/assets/lockup-navy.svg", dark: "./src/assets/lockup-light.svg", replacesTitle: true },
      favicon: "/favicon.svg",
      // IBM Plex is self-hosted (@fontsource), like the apps: no request to Google Fonts.
      customCss: [
        "@fontsource/ibm-plex-sans/400.css",
        "@fontsource/ibm-plex-sans/500.css",
        "@fontsource/ibm-plex-sans/600.css",
        "@fontsource/ibm-plex-mono/400.css",
        "./src/styles/soapay.css",
      ],
      social: [{ icon: "github", label: "GitHub", href: GITHUB }],
      editLink: { baseUrl: `${GITHUB}/edit/main/apps/docs/` },
      lastUpdated: true,
      head: [{ tag: "meta", attrs: { name: "theme-color", content: "#1E3A5F" } }],
      // Groups autogenerate from src/content/docs/<dir>; pages order themselves with `sidebar.order`.
      sidebar: [
        {
          label: "Start here",
          items: ["introduction", { label: "Getting started", items: [{ autogenerate: { directory: "getting-started" } }] }],
        },
        { label: "Concepts", items: [{ autogenerate: { directory: "concepts" } }] },
        { label: "Company app", items: [{ autogenerate: { directory: "company-app" } }] },
        { label: "Employee app", items: [{ autogenerate: { directory: "employee-app" } }] },
        { label: "Developers", items: [{ autogenerate: { directory: "developers" } }] },
        { label: "Reference", items: [{ autogenerate: { directory: "reference" } }] },
      ],
    }),
  ],
});
