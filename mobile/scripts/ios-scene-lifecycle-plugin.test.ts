import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  adoptSceneLifecycle
}: {
  adoptSceneLifecycle: (contents: string) => string
} = require('../plugins/ios-scene-lifecycle.js')

// The window block of Expo SDK 55's `ios/HelloWorld/AppDelegate.swift` template.
const TEMPLATE = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`

describe('ios-scene-lifecycle plugin', () => {
  it('moves React Native startup out of didFinishLaunching into a scene delegate', () => {
    const out = adoptSceneLifecycle(TEMPLATE)
    expect(out).not.toContain('UIWindow(frame: UIScreen.main.bounds)')
    expect(out).toContain('reactNativeFactory = factory')
    expect(out).toContain('class SceneDelegate: UIResponder, UIWindowSceneDelegate')
    expect(out).toContain('UIWindow(windowScene: windowScene)')
    expect(out).toContain('connectionOptions.urlContexts.first?.url')
  })

  it('is idempotent across repeated prebuilds', () => {
    const once = adoptSceneLifecycle(TEMPLATE)
    expect(adoptSceneLifecycle(once)).toBe(once)
  })

  it('fails loudly when the Expo template changes shape', () => {
    expect(() => adoptSceneLifecycle('class AppDelegate {}')).toThrow(/no longer matches/)
  })
})
