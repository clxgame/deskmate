#![cfg(windows)]

use std::{
    collections::HashMap,
    io,
    time::{Duration, Instant},
};

#[repr(C)]
struct ProcessEntry {
    size: u32,
    usage: u32,
    pid: u32,
    heap: usize,
    module: u32,
    threads: u32,
    parent: u32,
    priority: i32,
    flags: u32,
    executable: [u16; 260],
}
#[derive(Default)]
#[repr(C)]
struct FileTime {
    low: u32,
    high: u32,
}
impl FileTime {
    fn ticks(&self) -> u64 {
        u64::from(self.low) | (u64::from(self.high) << 32)
    }
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> isize;
    fn Process32FirstW(snapshot: isize, entry: *mut ProcessEntry) -> i32;
    fn Process32NextW(snapshot: isize, entry: *mut ProcessEntry) -> i32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
    fn GetProcessTimes(
        process: isize,
        created: *mut FileTime,
        exited: *mut FileTime,
        kernel: *mut FileTime,
        user: *mut FileTime,
    ) -> i32;
    fn GetSystemTimeAsFileTime(time: *mut FileTime);
    fn TerminateProcess(process: isize, exit_code: u32) -> i32;
    fn WaitForSingleObject(handle: isize, milliseconds: u32) -> u32;
    fn CloseHandle(handle: isize) -> i32;
}

struct Handle(isize);
impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: This uniquely owned non-null kernel handle is closed exactly once.
        if unsafe { CloseHandle(self.0) } == 0 {
            eprintln!("process handle close: {}", io::Error::last_os_error());
        }
    }
}
struct Process {
    handle: Handle,
    created: u64,
}
impl Process {
    fn open(pid: u32) -> Result<Option<Self>, String> {
        // SAFETY: Scalar arguments request a non-inheritable process handle; no pointers.
        let raw = unsafe { OpenProcess(0x0010_1001, 0, pid) };
        if raw == 0 {
            let error = io::Error::last_os_error();
            return if error.raw_os_error() == Some(87) {
                Ok(None)
            } else {
                Err(format!("open process {pid}: {error}"))
            };
        }
        let handle = Handle(raw);
        let (mut created, mut exited, mut kernel, mut user) = (
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
        );
        // SAFETY: The held process handle grants query access; all four outputs are distinct initialized FILETIME buffers.
        if unsafe { GetProcessTimes(handle.0, &mut created, &mut exited, &mut kernel, &mut user) }
            == 0
        {
            return Err(format!(
                "query process {pid}: {}",
                io::Error::last_os_error()
            ));
        }
        Ok(Some(Self {
            handle,
            created: created.ticks(),
        }))
    }
    fn stop(&self) -> Result<(), String> {
        // SAFETY: The live handle grants SYNCHRONIZE, and zero requests a nonblocking check.
        if unsafe { WaitForSingleObject(self.handle.0, 0) } == 0 {
            return Ok(());
        }
        // SAFETY: The owned handle grants PROCESS_TERMINATE and remains held through the wait below.
        if unsafe { TerminateProcess(self.handle.0, 1) } == 0 {
            let error = io::Error::last_os_error();
            // SAFETY: A concurrent natural exit is verified through the same held process handle.
            if unsafe { WaitForSingleObject(self.handle.0, 0) } != 0 {
                return Err(format!("terminate process: {error}"));
            }
        }
        Ok(())
    }
    fn wait(&self, deadline: Instant) -> Result<(), String> {
        let milliseconds = u32::try_from(
            deadline
                .saturating_duration_since(Instant::now())
                .as_millis(),
        )
        .map_err(|_| "process deadline overflow")?;
        // SAFETY: The process handle grants SYNCHRONIZE; the remaining total deadline bounds the wait.
        match unsafe { WaitForSingleObject(self.handle.0, milliseconds) } {
            0 => Ok(()),
            258 => Err("process tree termination timed out".into()),
            _ => Err(format!("wait process: {}", io::Error::last_os_error())),
        }
    }
}

fn snapshot() -> Result<(u64, Vec<(u32, u32)>), String> {
    let mut before = FileTime::default();
    // SAFETY: The output points to an initialized writable FILETIME of the documented layout.
    unsafe { GetSystemTimeAsFileTime(&mut before) };
    // SAFETY: TH32CS_SNAPPROCESS uses only scalar inputs and returns an owned snapshot handle.
    let raw = unsafe { CreateToolhelp32Snapshot(2, 0) };
    if raw == -1 {
        return Err(format!(
            "snapshot process tree: {}",
            io::Error::last_os_error()
        ));
    }
    let handle = Handle(raw);
    let mut entry = ProcessEntry {
        size: u32::try_from(std::mem::size_of::<ProcessEntry>())
            .map_err(|_| "process entry size overflow")?,
        usage: 0,
        pid: 0,
        heap: 0,
        module: 0,
        threads: 0,
        parent: 0,
        priority: 0,
        flags: 0,
        executable: [0; 260],
    };
    let mut entries = Vec::new();
    // SAFETY: The buffer has PROCESSENTRY32W's repr(C) layout and initialized dwSize; the snapshot handle remains owned.
    let mut present = unsafe { Process32FirstW(handle.0, &mut entry) };
    while present != 0 {
        entries.push((entry.pid, entry.parent));
        // SAFETY: The same valid snapshot and exclusive writable entry buffer remain alive.
        present = unsafe { Process32NextW(handle.0, &mut entry) };
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() != Some(18) {
        return Err(format!("enumerate process tree: {error}"));
    }
    Ok((before.ticks(), entries))
}

pub(crate) fn terminate(pid: u32) -> Result<(), String> {
    if pid == 0 || pid == std::process::id() {
        return Err("refusing to terminate zero or self".into());
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    let root = Process::open(pid)?.ok_or("process root no longer exists")?;
    let mut processes = HashMap::from([(pid, root)]);
    let mut order = vec![pid];
    let mut rescanning = false;
    loop {
        if Instant::now() >= deadline {
            return Err("process tree termination timed out".into());
        }
        let previous = processes.len();
        let (before, entries) = snapshot()?;
        loop {
            let mut discovered = false;
            for &(child, parent) in &entries {
                if processes.contains_key(&child) {
                    continue;
                }
                let Some(ancestor) = processes.get(&parent) else {
                    continue;
                };
                if child == 0 || child == std::process::id() {
                    return Err("refusing a process tree containing self".into());
                }
                let Some(process) = Process::open(child)? else {
                    continue;
                };
                // Reject stale parent IDs and PIDs reused after this snapshot began.
                if process.created < ancestor.created || process.created > before {
                    continue;
                }
                processes.insert(child, process);
                order.push(child);
                discovered = true;
            }
            if !discovered {
                break;
            }
            if Instant::now() >= deadline {
                return Err("process tree termination timed out".into());
            }
        }
        if rescanning && previous == processes.len() {
            return Ok(());
        }
        // Stop parents first, retain every handle, then rescan for children born during enumeration.
        for id in &order {
            processes
                .get(id)
                .ok_or("process tree identity lost")?
                .stop()?;
        }
        for process in processes.values() {
            process.wait(deadline)?;
        }
        rescanning = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::{BufRead, BufReader},
        os::windows::process::CommandExt,
        process::{Child, Command, Stdio},
    };
    struct ChildGuard(Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    #[test]
    fn rejects_zero_and_self() {
        assert!(terminate(0).is_err());
        assert!(terminate(std::process::id()).is_err());
    }
    #[test]
    fn kills_descendants_before_their_delayed_write_and_preserves_sibling() {
        let root = std::env::temp_dir().join(format!(
            "yume-tree-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let late = root.join("late.txt");
        let command = format!("& powershell.exe -NoLogo -NoProfile -NonInteractive -Command \"[Console]::WriteLine('READY'); Start-Sleep -Seconds 3; Set-Content -LiteralPath '{}' -Value LATE\"", late.to_string_lossy().replace('\'', "''"));
        let spawn = |command: &str| {
            Command::new("powershell.exe")
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    command,
                ])
                .creation_flags(0x08000000)
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap()
        };
        let mut unrelated = ChildGuard(spawn("Start-Sleep -Seconds 30"));
        let mut owned = ChildGuard(spawn(&command));
        let mut output = BufReader::new(owned.0.stdout.take().unwrap());
        let mut ready = String::new();
        output.read_line(&mut ready).unwrap();
        assert_eq!(ready.trim(), "READY");
        let started = Instant::now();
        terminate(owned.0.id()).unwrap();
        assert!(owned.0.try_wait().unwrap().is_some());
        println!("process tree stopped in {:?}", started.elapsed());
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(unrelated.0.try_wait().unwrap().is_none());
        std::thread::sleep(Duration::from_millis(3200).saturating_sub(started.elapsed()));
        assert!(
            !late.exists(),
            "terminated descendant still wrote after cancellation"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
