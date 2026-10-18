import { expect, type Locator, type Page } from '@stablyai/playwright-test'

async function renderedFrameHash(frame: Locator): Promise<string> {
  return frame.evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('Remote frame is not an image')
    }
    await image.decode()
    const bytes = await (await fetch(image.src)).arrayBuffer()
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  })
}

async function markerIsGreen(frame: Locator): Promise<boolean> {
  return frame.evaluate(async (image) => {
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('Remote frame is not an image')
    }
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Frame canvas unavailable')
    }
    context.drawImage(image, 0, 0)
    const [red, green, blue] = context.getImageData(32, 32, 1, 1).data
    return Math.abs(red - 16) < 12 && Math.abs(green - 224) < 12 && Math.abs(blue - 48) < 12
  })
}

export async function expectRemoteBrowserFrameFreshness({
  page,
  frame,
  evaluate,
  reload
}: {
  page: Page
  frame: Locator
  evaluate: (expression: string) => Promise<string>
  reload: () => Promise<void>
}): Promise<void> {
  const expectChanged = async (prior: string): Promise<void> => {
    await expect.poll(() => renderedFrameHash(frame), { timeout: 5000 }).not.toBe(prior)
  }
  let prior = await renderedFrameHash(frame)
  await evaluate(`(() => {
    const marker = document.createElement('div');
    marker.id = 'frame-freshness-marker';
    marker.style.cssText = 'position:fixed;left:8px;top:8px;width:64px;height:64px;z-index:999999;background:rgb(16,224,48)';
    const spacer = document.createElement('div');
    spacer.id = 'frame-freshness-spacer';
    spacer.style.height = '2400px';
    document.body.append(marker, spacer);
    return true;
  })()`)
  await expectChanged(prior)
  await expect.poll(() => markerIsGreen(frame)).toBe(true)

  prior = await renderedFrameHash(frame)
  const bounds = await frame.boundingBox()
  if (!bounds) {
    throw new Error('Remote frame has no bounds')
  }
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.7)
  await page.mouse.wheel(0, 60)
  await expect.poll(() => evaluate('scrollY')).toBe('60')
  await expectChanged(prior)

  for (const scrollY of [120, 60, 0, 120]) {
    prior = await renderedFrameHash(frame)
    await evaluate(`window.scrollTo(0, ${scrollY})`)
    await expect.poll(() => evaluate('scrollY')).toBe(String(scrollY))
    await expectChanged(prior)
  }

  // The final paint must survive host pacing after animation stops.
  await evaluate(
    'document.getElementById("frame-freshness-marker").style.background = "rgb(240,16,240)"'
  )
  await expect.poll(() => markerIsGreen(frame)).toBe(false)
  await evaluate(`new Promise(resolve => {
    const marker = document.getElementById('frame-freshness-marker');
    let frame = 0;
    const animate = () => {
      marker.style.background = frame % 2 ? 'rgb(240,16,240)' : 'rgb(16,16,240)';
      window.scrollTo(0, frame * 10);
      if (++frame < 8) requestAnimationFrame(animate);
      else { marker.style.background = 'rgb(16,224,48)'; resolve(true); }
    };
    marker.style.background = 'rgb(240,16,240)';
    requestAnimationFrame(animate);
  })`)
  await expect.poll(() => markerIsGreen(frame), { timeout: 5000 }).toBe(true)
  prior = await renderedFrameHash(frame)
  await reload()
  await expect
    .poll(() => evaluate('Boolean(document.getElementById("frame-freshness-marker"))'))
    .toBe('false')
  await expectChanged(prior)
}
