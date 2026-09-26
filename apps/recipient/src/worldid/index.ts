/**
 * THE World ID swap point: the real `@soapay/worldid-react` component, or the mock in VITE_MOCK_API
 * mode. Call sites import `HumanCheck` from here and pass only HumanCheckProps.
 */
import { ENV } from "../config.js";
import { MockHumanCheck } from "./MockHumanCheck.js";
import { WorldHumanCheck } from "./WorldHumanCheck.js";

export const HumanCheck = ENV.mockApi ? MockHumanCheck : WorldHumanCheck;
export * from "./types.js";
