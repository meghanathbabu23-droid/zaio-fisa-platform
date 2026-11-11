import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// With `globals: false` in vitest.config.ts, @testing-library/react's
// automatic afterEach-based cleanup never registers (it only looks for a
// global `afterEach`), so without this, DOM from each render() accumulates
// across tests in the same file. Register it explicitly instead.
afterEach(() => {
  cleanup();
});
