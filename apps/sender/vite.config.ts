import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA only: keys and requests never touch a server we run. Styles come from @soapay/ui.
export default defineConfig({ plugins: [react()] });
