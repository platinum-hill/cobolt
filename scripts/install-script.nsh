!macro customInstall
  DetailPrint "Setting up dependencies for Cobolt..."
  
  ; Create a flag file to ensure we only run this script once
  FileOpen $0 "$INSTDIR\first_run.lock" w
  FileWrite $0 "This file prevents the dependencies script from running again."
  FileClose $0
  
  DetailPrint "Installing required dependencies..."
  ExecWait '"$INSTDIR\resources\scripts\win_deps.bat"'
  
  DetailPrint "Dependencies installation completed."
!macroend
