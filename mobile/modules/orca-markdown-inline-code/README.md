# Android inline code

This optional Expo module decorates the original characters of a mounted Android
TextView. Replacement spans draw rounded backgrounds and horizontal padding without
introducing inline views, images, or extra clipboard characters. Existing clickable
and style spans remain in the text. UTF-16 offsets match React strings and Android.

The caller supplies the expected complete text; a recycled or streamed view with
different text is rejected. Code longer than the viewport is split at fitting text
boundaries, respecting surrogate pairs and newlines. The returned layout height
lets the React Native parent allocate room for wrapped text. Theme changes repaint
with the current surface color. Calls run on the Android UI thread.

Older native shells use the ordinary React Native text fallback. A native rebuild
is required to enable this module; no host or RPC changes are involved.
