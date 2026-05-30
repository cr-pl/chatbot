Option Explicit

Dim fso, shell, projectRoot, electronCmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = projectRoot

electronCmd = projectRoot & "\node_modules\.bin\electron.cmd"

If Not fso.FileExists(electronCmd) Then
  MsgBox "Ruleaza mai intai npm install in folderul proiectului chatbot.", vbCritical, "Local AI Chatbot"
  WScript.Quit 1
End If

shell.Run """" & electronCmd & """ .", 0, False
