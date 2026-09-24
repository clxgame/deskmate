#[cfg(windows)]
#[path = "../src-tauri/src/windows_process_tree.rs"]
mod windows_process_tree;

#[cfg(windows)]
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let pid = match args.as_slice() {
        [flag, pid, tree, force]
            if flag.eq_ignore_ascii_case("/pid")
                && ((tree.eq_ignore_ascii_case("/t") && force.eq_ignore_ascii_case("/f"))
                    || (tree.eq_ignore_ascii_case("/f") && force.eq_ignore_ascii_case("/t"))) =>
        {
            pid.parse::<u32>().ok()
        }
        _ => None,
    };
    let result = pid
        .ok_or_else(|| "Expected /PID <pid> /T /F".to_owned())
        .and_then(windows_process_tree::terminate);
    if let Err(error) = result {
        eprintln!("YUME process termination: {error}");
        std::process::exit(1);
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("YUME process termination requires Windows");
    std::process::exit(1);
}
