import type { BrowserGrabRect } from '../browser-grab-types'
import { GRAB_GUEST_CONTENT_SCRIPT } from './grab-guest-content-script'
import { GRAB_GUEST_ELEMENT_CONTEXT_SCRIPT } from './grab-guest-element-context-script'
import { GRAB_GUEST_EXTRACTION_HELPERS_SCRIPT } from './grab-guest-foundation-script'
import { GRAB_GUEST_REACT_SCRIPT } from './grab-guest-react-script'

export type RemoteGrabPoint = { x: number; y: number }

/** The host answered with something this client cannot read — an older or foreign peer. */
export class RemoteGrabProtocolError extends Error {}
export type RemoteGrabViewport = { width: number; height: number }

export type RemoteGrabQuery =
  | { kind: 'probe' }
  | {
      kind: 'preview' | 'select'
      point: RemoteGrabPoint
      /** Document identity the client armed against; a different one means the page navigated. */
      document: string
      /** CSS viewport the client mapped the point with. */
      viewport: RemoteGrabViewport
      /** Root scroll of the frame the user clicked on, when the frame reported one. */
      scroll?: RemoteGrabPoint | null
    }

type RemoteGrabQueryContext = {
  document: string
  viewport: RemoteGrabViewport
  scroll: RemoteGrabPoint
}

export type RemoteGrabPreviewTarget = {
  tagName: string
  role: string | null
  text: string
  rect: BrowserGrabRect
}

export type RemoteGrabQueryResult = RemoteGrabQueryContext &
  (
    | { status: 'ready' | 'empty' }
    | { status: 'stale'; reason: 'document' | 'viewport' | 'scroll' }
    | { status: 'preview'; target: RemoteGrabPreviewTarget }
    | { status: 'selected'; payload: unknown }
  )

// Why: the page owns window, so this only fences navigation; a hostile page can at most force a stale result.
const DOCUMENT_KEY = '__orcaRemoteGrabDocument'
const VIEWPORT_TOLERANCE_PX = 2
const SCROLL_TOLERANCE_PX = 2

// Small on purpose: previews run many times per second and must not ship the extraction bundle.
const PREVIEW_TEXT_SCRIPT = `
  function previewText(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var text = '';
    for (var i = 0; i < 40 && text.length < 60; i++) {
      var node = walker.nextNode();
      if (!node) break;
      text += ' ' + String(node.nodeValue || '').slice(0, 60);
    }
    text = text.replace(/\\s+/g, ' ').trim();
    return text.length > 40 ? text.slice(0, 37) + '...' : text;
  }
`

function finite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Invalid element selection coordinates')
  }
  return value
}

/**
 * One self-contained, side-effect-free evaluation: hit-test the given CSS viewport point and
 * answer for that exact element. Nothing is installed in the page, no input is dispatched, and
 * document/viewport/scroll are rechecked in the same evaluation that reads the element.
 */
export function buildRemoteGrabPointScript(query: RemoteGrabQuery): string {
  const context = `
    var key = ${JSON.stringify(DOCUMENT_KEY)};
    if (typeof window[key] !== 'string') {
      var id = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : String(Math.random()).slice(2) + String(Date.now());
      try { Object.defineProperty(window, key, { value: id, enumerable: false }); } catch (e) {}
    }
    var context = {
      document: String(window[key] || ''),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY }
    };
    function answer(status, extra) {
      var result = { status: status, document: context.document, viewport: context.viewport, scroll: context.scroll };
      for (var name in extra) result[name] = extra[name];
      return result;
    }
  `
  if (query.kind === 'probe') {
    return `(function() { 'use strict'; ${context} return answer('ready', {}); })()`
  }
  const x = finite(query.point.x)
  const y = finite(query.point.y)
  const width = finite(query.viewport.width)
  const height = finite(query.viewport.height)
  const scroll = query.scroll
    ? `{ x: ${finite(query.scroll.x)}, y: ${finite(query.scroll.y)} }`
    : 'null'
  const fence = `
    if (context.document !== ${JSON.stringify(query.document)}) return answer('stale', { reason: 'document' });
    if (Math.abs(context.viewport.width - ${width}) > ${VIEWPORT_TOLERANCE_PX} ||
        Math.abs(context.viewport.height - ${height}) > ${VIEWPORT_TOLERANCE_PX}) {
      return answer('stale', { reason: 'viewport' });
    }
    var expectedScroll = ${scroll};
    if (expectedScroll && (Math.abs(context.scroll.x - expectedScroll.x) > ${SCROLL_TOLERANCE_PX} ||
        Math.abs(context.scroll.y - expectedScroll.y) > ${SCROLL_TOLERANCE_PX})) {
      return answer('stale', { reason: 'scroll' });
    }
    var el = ${x} >= 0 && ${y} >= 0 && ${x} < context.viewport.width && ${y} < context.viewport.height
      ? document.elementFromPoint(${x}, ${y})
      : null;
    if (!el || el === document.documentElement || el === document.body) return answer('empty', {});
  `
  if (query.kind === 'preview') {
    return `(function() {
      'use strict';
      ${context}
      ${PREVIEW_TEXT_SCRIPT}
      ${fence}
      var rect = el.getBoundingClientRect();
      return answer('preview', { target: {
        tagName: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        text: previewText(el),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      } });
    })()`
  }
  return `(function() {
    'use strict';
    ${GRAB_GUEST_EXTRACTION_HELPERS_SCRIPT}
    ${GRAB_GUEST_CONTENT_SCRIPT}
    ${GRAB_GUEST_ELEMENT_CONTEXT_SCRIPT}
    ${GRAB_GUEST_REACT_SCRIPT}
    ${context}
    ${fence}
    return answer('selected', { payload: extractPayload(el) });
  })()`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readPoint(value: unknown): RemoteGrabPoint | null {
  const x = isRecord(value) ? readNumber(value.x) : null
  const y = isRecord(value) ? readNumber(value.y) : null
  return x === null || y === null ? null : { x, y }
}

function readSize(value: unknown): RemoteGrabViewport | null {
  const width = isRecord(value) ? readNumber(value.width) : null
  const height = isRecord(value) ? readNumber(value.height) : null
  return width === null || height === null ? null : { width, height }
}

function readRect(value: unknown): BrowserGrabRect | null {
  const origin = readPoint(value)
  const size = readSize(value)
  return origin && size ? { ...origin, ...size } : null
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/**
 * Decodes a `browser.eval` response. The Electron host JSON-encodes object results; other
 * providers may hand back the object itself, so both are accepted.
 */
export function readRemoteGrabQueryResult(response: unknown): RemoteGrabQueryResult {
  const raw = isRecord(response) && 'result' in response ? response.result : response
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      value = null
    }
  }
  if (!isRecord(value)) {
    throw new RemoteGrabProtocolError('Element selection returned an invalid response.')
  }
  const document = typeof value.document === 'string' ? value.document.slice(0, 200) : ''
  const viewport = readSize(value.viewport)
  const scroll = readPoint(value.scroll)
  if (!document || !viewport || !scroll) {
    throw new RemoteGrabProtocolError('Element selection returned an invalid response.')
  }
  const context = { document, viewport, scroll }
  switch (value.status) {
    case 'ready':
    case 'empty':
      return { ...context, status: value.status }
    case 'stale':
      if (value.reason === 'document' || value.reason === 'viewport' || value.reason === 'scroll') {
        return { ...context, status: 'stale', reason: value.reason }
      }
      break
    case 'preview': {
      const target = isRecord(value.target) ? value.target : null
      const rect = target ? readRect(target.rect) : null
      if (target && rect) {
        return {
          ...context,
          status: 'preview',
          target: {
            tagName: clampText(target.tagName, 50),
            role: typeof target.role === 'string' ? target.role.slice(0, 100) : null,
            text: clampText(target.text, 60),
            rect
          }
        }
      }
      break
    }
    case 'selected':
      return { ...context, status: 'selected', payload: value.payload }
  }
  throw new RemoteGrabProtocolError('Element selection returned an invalid response.')
}
