#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Rect {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Size {
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Point {
    pub x: i64,
    pub y: i64,
}

pub(crate) fn position_chat(pet: Rect, chat: Size, work_area: Rect, gap: i64) -> Point {
    let work_right = work_area.x + work_area.width;
    let work_bottom = work_area.y + work_area.height;
    let pet_center_x = pet.x + pet.width / 2;
    let work_center_x = work_area.x + work_area.width / 2;

    let left = pet.x - chat.width - gap;
    let right = pet.x + pet.width + gap;
    let preferred_x = if pet_center_x >= work_center_x {
        if left >= work_area.x {
            left
        } else {
            right
        }
    } else if right + chat.width <= work_right {
        right
    } else {
        left
    };
    let preferred_y = pet.y + pet.height - chat.height;

    Point {
        x: clamp_window_axis(preferred_x, work_area.x, work_right - chat.width),
        y: clamp_window_axis(preferred_y, work_area.y, work_bottom - chat.height),
    }
}

pub(crate) fn position_pet_bottom_right(pet: Size, work_area: Rect, gap: i64) -> Point {
    let gap = gap.max(0);
    Point {
        x: clamp_window_axis(
            work_area.x + work_area.width - pet.width - gap,
            work_area.x,
            work_area.x + work_area.width - pet.width,
        ),
        y: clamp_window_axis(
            work_area.y + work_area.height - pet.height - gap,
            work_area.y,
            work_area.y + work_area.height - pet.height,
        ),
    }
}

pub(crate) fn smooth_step(current: Point, target: Point, amount: f64) -> Point {
    let amount = if amount.is_finite() {
        amount.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let step = |from: i64, to: i64| {
        let delta = to - from;
        if delta.abs() <= 2 {
            return to;
        }
        let moved = (delta as f64 * amount).round() as i64;
        let moved = if moved == 0 { delta.signum() } else { moved };
        (from + moved).clamp(from.min(to), from.max(to))
    };
    Point {
        x: step(current.x, target.x),
        y: step(current.y, target.y),
    }
}

fn clamp_window_axis(value: i64, min: i64, max: i64) -> i64 {
    if max < min {
        min
    } else {
        value.clamp(min, max)
    }
}

#[cfg(test)]
mod tests {
    use super::{position_chat, position_pet_bottom_right, smooth_step, Point, Rect, Size};

    const WORK: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    const CHAT: Size = Size {
        width: 420,
        height: 560,
    };

    #[test]
    fn bottom_right_pet_opens_chat_to_the_left_and_bottom_aligned() {
        let point = position_chat(
            Rect {
                x: 1580,
                y: 720,
                width: 320,
                height: 360,
            },
            CHAT,
            WORK,
            8,
        );

        assert_eq!(point, Point { x: 1152, y: 520 });
    }

    #[test]
    fn top_left_pet_opens_chat_to_the_right_and_bottom_aligned() {
        let point = position_chat(
            Rect {
                x: 16,
                y: 24,
                width: 320,
                height: 360,
            },
            CHAT,
            WORK,
            8,
        );

        assert_eq!(point, Point { x: 344, y: 0 });
    }

    #[test]
    fn chat_is_clamped_when_the_pet_is_near_an_edge() {
        let point = position_chat(
            Rect {
                x: 1810,
                y: 10,
                width: 100,
                height: 100,
            },
            CHAT,
            WORK,
            8,
        );

        assert_eq!(point, Point { x: 1382, y: 0 });
    }

    #[test]
    fn default_pet_position_is_inside_the_bottom_right_work_area() {
        assert_eq!(
            position_pet_bottom_right(
                Size {
                    width: 320,
                    height: 420,
                },
                WORK,
                16,
            ),
            Point { x: 1584, y: 644 }
        );
    }

    #[test]
    fn smooth_step_moves_toward_target_without_jumping() {
        assert_eq!(
            smooth_step(Point { x: 0, y: 0 }, Point { x: 100, y: 50 }, 0.25),
            Point { x: 25, y: 13 }
        );
        assert_eq!(
            smooth_step(Point { x: 98, y: 49 }, Point { x: 100, y: 50 }, 0.25),
            Point { x: 100, y: 50 }
        );
    }
}
