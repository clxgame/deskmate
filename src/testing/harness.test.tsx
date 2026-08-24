import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

/**
 * Guards the component-test infrastructure itself: a DOM exists, React renders
 * into it, and user events drive state. Memory UI tests rely on all three.
 */

afterEach(cleanup);

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      count {count}
    </button>
  );
}

describe("component test harness", () => {
  test("provides a DOM document for React to render into", () => {
    expect(typeof document).toBe("object");
    render(<Counter />);
    expect(screen.getByRole("button").textContent).toBe("count 0");
  });

  test("dispatches real user events into rendered components", async () => {
    render(<Counter />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("count 1");
  });
});
