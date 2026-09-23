import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  addPodDeploymentTargetHook
}: {
  addPodDeploymentTargetHook: (contents: string) => string
} = require('../plugins/ios-pod-deployment-target.js')

// The post_install block of Expo SDK 55's `ios/Podfile` template.
const PODFILE = `target 'HelloWorld' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`

describe('ios-pod-deployment-target plugin', () => {
  it('raises pod targets after react_native_post_install, inside post_install', () => {
    const out = addPodDeploymentTargetHook(PODFILE)
    const rnCall = out.indexOf('react_native_post_install(')
    const hook = out.indexOf("podfile_properties['ios.deploymentTarget']")
    const blockEnd = out.indexOf('\n  end\n', rnCall)
    expect(rnCall).toBeGreaterThan(-1)
    expect(hook).toBeGreaterThan(rnCall)
    expect(hook).toBeLessThan(blockEnd)
    expect(out).toContain(
      "build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = app_deployment_target"
    )
  })

  it('only raises targets, never lowers them', () => {
    expect(addPodDeploymentTargetHook(PODFILE)).toContain(
      'Gem::Version.new(current) < Gem::Version.new(app_deployment_target)'
    )
  })

  it('is idempotent across repeated prebuilds', () => {
    const once = addPodDeploymentTargetHook(PODFILE)
    expect(addPodDeploymentTargetHook(once)).toBe(once)
  })

  it('fails loudly when the Podfile template changes shape', () => {
    expect(() => addPodDeploymentTargetHook("target 'X' do\nend\n")).toThrow(
      /no react_native_post_install/
    )
  })
})
