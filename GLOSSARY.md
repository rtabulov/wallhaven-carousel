# Wallhaven Carousel

A DMS plugin for browsing a local wallpaper library, discovering Wallhaven images, and applying them as the desktop background.

## Language

**Delete confirm**:
The brief pause after the user asks to delete a wallpaper, before it is moved to the Trash. The wallpaper is named in the prompt; the user must confirm or cancel.
_Avoid_: Chord, timed double-tap, operator-pending

**Confirm**:
Accepting the delete confirm and moving that wallpaper to the Trash.
_Avoid_: Commit, execute delete

**Cancel**:
Leaving the delete confirm without moving the wallpaper.
_Avoid_: Abort, dismiss
