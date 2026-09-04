!macro NSIS_HOOK_PREINSTALL
  ; Stop the current YUME process and its bundled sidecar before copying.
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("YUME_INSTALL_DIR", "$INSTDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("DESKMATE_INSTALL_DIR", "$INSTDIR").r0'
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -EncodedCommand JABlAD0AJABlAG4AdgA6AFkAVQBNAEUAXwBJAE4AUwBUAEEATABMAF8ARABJAFIAOwBpAGYAKAAhACQAZQApAHsAJABlAD0AJABlAG4AdgA6AEQARQBTAEsATQBBAFQARQBfAEkATgBTAFQAQQBMAEwAXwBEAEkAUgB9ADsAJAB0AHMAPQBAACgAIgAkAGUAXABZAFUATQBFAC4AZQB4AGUAIgAsACIAJABlAFwAZABlAHMAawBtAGEAdABlAC4AZQB4AGUAIgApADsAJABwAD0ARwBlAHQALQBDAGkAbQBJAG4AcwB0AGEAbgBjAGUAIABXAGkAbgAzADIAXwBQAHIAbwBjAGUAcwBzAHwAPwB7ACQAXwAuAEUAeABlAGMAdQB0AGEAYgBsAGUAUABhAHQAaAAgAC0AaQBuACAAJAB0AHMAfQA7AGkAZgAoACQAcAApAHsAJABwAHwAJQB7AFMAdABvAHAALQBQAHIAbwBjAGUAcwBzACAALQBJAGQAIAAkAF8ALgBQAHIAbwBjAGUAcwBzAEkAZAAgAC0ARgBvAHIAYwBlAH0AfQA='
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -EncodedCommand JABlAD0AJABlAG4AdgA6AFkAVQBNAEUAXwBJAE4AUwBUAEEATABMAF8ARABJAFIAOwBpAGYAKAAhACQAZQApAHsAJABlAD0AJABlAG4AdgA6AEQARQBTAEsATQBBAFQARQBfAEkATgBTAFQAQQBMAEwAXwBEAEkAUgB9ADsAJAB0AD0AIgAkAGUAXAByAGUAcwBvAHUAcgBjAGUAcwBcAG8AcABlAG4AYwBvAGQAZQBcAG8AcABlAG4AYwBvAGQAZQAuAGUAeABlACIAOwAkAHAAPQBHAGUAdAAtAEMAaQBtAEkAbgBzAHQAYQBuAGMAZQAgAFcAaQBuADMAMgBfAFAAcgBvAGMAZQBzAHMAfAA/AHsAJABfAC4ATgBhAG0AZQAgAC0AZQBxACAAJwBvAHAAZQBuAGMAbwBkAGUALgBlAHgAZQAnACAALQBhAG4AZAAgACQAXwAuAEUAeABlAGMAdQB0AGEAYgBsAGUAUABhAHQAaAAgAC0AZQBxACAAJAB0ACAALQBhAG4AZAAgACQAXwAuAEMAbwBtAG0AYQBuAGQATABpAG4AZQAgAC0AbABpAGsAZQAgACcAKgB0AGEAdQByAGkALgBsAG8AYwBhAGwAaABvAHMAdAAqACcAfQA7AGkAZgAoACQAcAApAHsAUwB0AG8AcAAtAFAAcgBvAGMAZQBzAHMAIAAtAEkAZAAgACQAcAAuAFAAcgBvAGMAZQBzAHMASQBkACAALQBGAG8AcgBjAGUAfQA='
  Pop $0
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("YUME_INSTALL_DIR", "").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i("DESKMATE_INSTALL_DIR", "").r0'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Forget the remembered install directory on a real uninstall.
  ;
  ; The generated installer only clears `Software\<manufacturer>\<product>` when
  ; the user ticks "delete application data", and that box is always unchecked
  ; during a silent (/S) uninstall. The stale path then wins over the default in
  ; RestorePreviousInstallLocation, so the next install silently lands back in
  ; the previous directory - even one the user has since moved away from.
  ;
  ; An update (/UPDATE) must keep the value so it reinstalls in place; only a
  ; genuine uninstall forgets it. App data is untouched here: it lives in
  ; %APPDATA%\<bundle id> and the API key lives in Windows Credential Manager,
  ; both outside this key.
  ${If} $UpdateMode <> 1
    DeleteRegValue SHCTX "${MANUPRODUCTKEY}" ""
    DeleteRegValue SHCTX "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
  ${EndIf}
!macroend
