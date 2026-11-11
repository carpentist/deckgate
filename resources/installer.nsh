!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Remove our hooks while the installed app can still run its CLI.
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-hooks'
    ${EndIf}

    ; Full uninstall: history, settings, backups, spool and approval token.
    ; This is intentionally destructive. Upgrades (isUpdated) are exempt.
    RMDir /r "$APPDATA\Deckgate"
    RMDir /r "$LOCALAPPDATA\Deckgate"
  ${endIf}
!macroend
