// Must run before any screen module: it applies the palette and text size.
import './src/theme/appearance-boot'
// Headless notification launches do not mount the router layout.
import './src/notifications/push-background-dismissal'
import 'expo-router/entry'
