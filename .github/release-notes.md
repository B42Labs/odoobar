## Install

OdooBar runs on macOS 13 or newer on a Mac with Apple Silicon.

1. Download the `.dmg` file under "Assets" below, open it, and drag OdooBar to the Applications folder.
2. Open OdooBar. macOS blocks the first start, because this build has no Developer ID signature and is not notarized. Close the message with "Done".
3. Open System Settings, go to "Privacy & Security", scroll down to "Security", and click "Open Anyway" next to the message about OdooBar. Confirm with "Open Anyway" and your password or Touch ID.

macOS asks once per installed version. On macOS 13 and 14 there is a shorter way: Control-click OdooBar in the Applications folder, choose "Open", and confirm with "Open".

Instead of steps 2 and 3 you can remove the download mark in Terminal:

    xattr -dr com.apple.quarantine /Applications/OdooBar.app

## Update

OdooBar shows a button in its app bar when a newer release exists. Download the new `.dmg`, quit OdooBar, replace the app in the Applications folder, and open it as described above. Your configuration and your Odoo login stay.
