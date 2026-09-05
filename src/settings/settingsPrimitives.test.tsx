import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Row, Switch } from "./settingsPrimitives";

afterEach(cleanup);

describe("settings primitives", () => {
  test("renders row content with the existing settings row classes", () => {
    render(
      <Row label="Gateway">
        <input aria-label="Gateway input" />
      </Row>,
    );

    expect(screen.getByText("Gateway").className).toBe("set-row-label");
    expect(screen.getByLabelText("Gateway input").parentElement?.className).toBe(
      "set-row-control",
    );
  });

  test("renders an accessible switch that reports checked changes", async () => {
    const onChange = mock<(checked: boolean) => void>();

    render(<Switch checked={false} label="Enable YUME" onChange={onChange} />);

    const checkbox = screen.getByRole("checkbox", { name: "Enable YUME" });
    expect(checkbox).toBeInstanceOf(HTMLInputElement);

    await userEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
