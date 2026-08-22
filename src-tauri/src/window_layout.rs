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
    let pet_center_y = pet.y + pet.height / 2;
    let work_center_x = work_area.x + work_area.width / 2;
    let work_center_y = work_area.y + work_area.height / 2;

    let left = pet.x - chat.width - gap;
    let right = pet.x + pet.width + gap;
    let above = pet.y - chat.height - gap;
    let below = pet.y + pet.height + gap;

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
    let preferred_y = if pet_center_y >= work_center_y {
        if above >= work_area.y {
            above
        } else {
            below
        }
    } else if below + chat.height <= work_bottom {
        below
    } else {
        above
    };

    Point {
        x: clamp_window_axis(preferred_x, work_area.x, work_right - chat.width),
        y: clamp_window_axis(preferred_y, work_area.y, work_bottom - chat.height),
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
    use super::{position_chat, Point, Rect, Size};

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
    fn bottom_right_pet_opens_chat_to_the_left_and_above() {
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

        assert_eq!(point, Point { x: 1152, y: 152 });
    }

    #[test]
    fn top_left_pet_opens_chat_to_the_right_and_below() {
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

        assert_eq!(point, Point { x: 344, y: 392 });
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

        assert_eq!(point, Point { x: 1382, y: 118 });
    }
}
