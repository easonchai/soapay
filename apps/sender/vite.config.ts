import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Static SPA only: keys and requests never touch a server we run.
export default defineConfig({ plugins: [react(), tailwindcss()] });
