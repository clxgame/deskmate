import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { dict } from "../../lib/i18n";
import { TimePicker } from "./TimePicker";
import { installTimePopoverFixture } from "../../testing/timePopoverFixture";
installTimePopoverFixture();

const t = dict("zh-CN");
afterEach(cleanup);

function Fixture() {
  const [value, setValue] = useState("09:00");
  return <><TimePicker value={value} onChange={setValue} t={t} /><button type="button">Outside</button></>;
}

function openPicker() {
  render(<Fixture />);
  fireEvent.click(screen.getByRole("button", { name: t.taskTime }));
  return {
    hours: screen.getByRole("listbox", { name: t.timePickerHour }),
    minutes: screen.getByRole("listbox", { name: t.timePickerMinute }),
  };
}

describe("themed time picker", () => {
  for (const [hour, minute] of [["00", "00"], ["23", "59"], ["09", "37"]] as const) {
    test(`commits ${hour}:${minute} only when the draft is confirmed`, () => {
      const { hours, minutes } = openPicker();
      fireEvent.click(within(hours).getByRole("option", { name: hour }));
      fireEvent.click(within(minutes).getByRole("option", { name: minute }));
      expect(screen.getByRole("button", { name: t.taskTime }).textContent).toBe("09:00");
      fireEvent.click(screen.getByRole("button", { name: t.timePickerConfirm }));
      expect(screen.getByRole("button", { name: t.taskTime }).textContent).toBe(`${hour}:${minute}`);
      expect(screen.queryByRole("dialog")).toBe(null);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: t.taskTime }));
    });
  }

  test("discards the draft and restores focus when Escape is pressed", () => {
    const { hours } = openPicker();
    fireEvent.click(within(hours).getByRole("option", { name: "17" }));
    fireEvent.keyDown(hours, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(screen.getByRole("button", { name: t.taskTime }).textContent).toBe("09:00");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t.taskTime }));
  });

  test("restores the committed value when a cancelled picker reopens", () => {
    const { hours } = openPicker();
    fireEvent.click(within(hours).getByRole("option", { name: "17" }));
    fireEvent.click(screen.getByRole("button", { name: t.timePickerCancel }));
    fireEvent.click(screen.getByRole("button", { name: t.taskTime }));
    expect(within(screen.getByRole("listbox", { name: t.timePickerHour }))
      .getByRole("option", { selected: true }).textContent).toBe("09");
  });

  test("dismisses without stealing focus when a different control is clicked", async () => {
    const user = userEvent.setup();
    const { minutes } = openPicker();
    fireEvent.click(within(minutes).getByRole("option", { name: "37" }));
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Outside" }));
    expect(screen.getByRole("button", { name: t.taskTime }).textContent).toBe("09:00");
  });

  test("selects the day boundary using End and Enter through both columns", async () => {
    const user = userEvent.setup();
    openPicker();
    await user.keyboard("{End}{Enter}{End}{Enter}{Enter}");
    expect(screen.getByRole("button", { name: t.taskTime }).textContent).toBe("23:59");
    expect(screen.queryByRole("dialog")).toBe(null);
  });

  test("wraps arrow navigation and supports Home within a column", () => {
    const { hours } = openPicker();
    fireEvent.keyDown(hours, { key: "Home" });
    fireEvent.keyDown(hours, { key: "ArrowUp" });
    expect(within(hours).getByRole("option", { selected: true }).textContent).toBe("23");
    fireEvent.keyDown(hours, { key: "ArrowDown" });
    expect(within(hours).getByRole("option", { selected: true }).textContent).toBe("00");
  });

  test("lets Tab leave the popup and discards its unconfirmed draft", async () => {
    const user = userEvent.setup();
    openPicker();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("listbox", { name: t.timePickerMinute }));
    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).toBe(null);
  });
});

test("closes an expanded picker when its trigger is clicked again", async () => {
  const user = userEvent.setup();
  openPicker();
  await user.click(screen.getByRole("button", { name: t.taskTime }));
  expect(screen.queryByRole("dialog")).toBe(null);
});
test("lets Shift+Tab return to the trigger and close the unconfirmed picker", async () => {
  const user = userEvent.setup();
  openPicker();
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: t.taskTime }));
  expect(screen.queryByRole("dialog")).toBe(null);
});