# Wallhaven Carousel

A DMS plugin for browsing a local wallpaper library, discovering Wallhaven images, and applying them as the desktop background.

## Language

**Discover**:
The Wallhaven search the user browses before a wallpaper is in the library.
_Avoid_: Search mode, browse

**Preview**:
The selected Discover result at full size, before it is downloaded.
_Avoid_: Lightbox, fullscreen viewer

**Next**:
Moving forward one loaded result while Preview is open. Right, L, and the wheel.
_Avoid_: Load more, next page

**Load more**:
The next page of the current Discover search, appended to the results already loaded.
_Avoid_: Next page, pagination, infinite scroll

**Notice**:
A short message inside Preview when Load more fails, or when the search has no further page.
_Avoid_: Toast, notification, banner

**Wallhaven page**:
The public wallhaven.cc page for a wallpaper (`/w/{id}`), opened from Discover.
_Avoid_: Browser, external link, source, meta page

**Delete confirm**:
The brief pause after the user asks to delete a wallpaper, before it is moved to the Trash. The wallpaper is named in the prompt; the user must confirm or cancel.
_Avoid_: Chord, timed double-tap, operator-pending

**Confirm**:
Accepting the delete confirm and moving that wallpaper to the Trash.
_Avoid_: Commit, execute delete

**Cancel**:
Leaving the delete confirm without moving the wallpaper.
_Avoid_: Abort, dismiss
