#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Leaving,
    Reset,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Request {
    pub token: u64,
    pub phase: Phase,
}

pub struct Lifecycle {
    pub desired_visible: bool,
    token: u64,
    pub pending: Option<Request>,
}

impl Lifecycle {
    pub const fn feedback_visible(&self, native_visible: bool) -> bool {
        self.desired_visible && native_visible
    }

    pub const fn new(visible: bool) -> Self {
        Self {
            desired_visible: visible,
            token: 0,
            pending: None,
        }
    }

    pub fn request(&mut self, visible: bool, animated: bool) -> Option<Request> {
        self.desired_visible = visible;
        self.token += 1;
        self.pending = animated.then_some(Request {
            token: self.token,
            phase: if visible {
                Phase::Reset
            } else {
                Phase::Leaving
            },
        });
        self.pending
    }

    pub fn acknowledge(&mut self, token: u64) -> Option<Phase> {
        let request = self.pending?;
        if request.token != token {
            return None;
        }
        self.pending = None;
        Some(request.phase)
    }

    pub fn fallback(&mut self, token: u64) -> bool {
        match self.pending {
            Some(Request {
                token: current,
                phase: Phase::Leaving,
            }) if current == token && !self.desired_visible => {
                self.pending = None;
                true
            }
            Some(Request {
                phase: Phase::Leaving | Phase::Reset,
                ..
            })
            | None => false,
        }
    }

    pub fn reset_timed_out(&mut self, token: u64) -> bool {
        match self.pending {
            Some(Request {
                token: current,
                phase: Phase::Reset,
            }) if current == token && self.desired_visible => {
                self.pending = None;
                true
            }
            Some(Request {
                phase: Phase::Leaving | Phase::Reset,
                ..
            })
            | None => false,
        }
    }
}

#[cfg(test)]
#[path = "pet_visibility_tests.rs"]
mod tests;
