//! Local, user-visible memory: storage, policy, and typed commands.
//!
//! Rust owns every decision. The frontend proposes; this module validates,
//! classifies, stores, retrieves, and hard-deletes.

pub mod commands;
#[cfg(test)]
mod cross_process_tests;
pub mod domain;
pub mod error;
pub mod export;
#[cfg(test)]
mod perf_tests;
pub mod policy;
pub mod repository;
#[cfg(test)]
mod repository_tests;
pub mod retrieval;
#[cfg(test)]
mod retrieval_tests;
pub mod storage;

pub use commands::MemoryState;
