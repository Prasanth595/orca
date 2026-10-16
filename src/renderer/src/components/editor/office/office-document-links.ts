import { openCsvHttpLink } from '../csv/csv-link-routing'

/** Rendered documents carry author-controlled links; a plain click would navigate Orca's own window. */
export function routeOfficeDocumentLinkClick(
  event: MouseEvent,
  container: HTMLElement,
  filePath: string
): void {
  if (!(event.target instanceof Element)) {
    return
  }
  const anchor = event.target.closest('a[href]')
  if (!anchor || !container.contains(anchor)) {
    return
  }
  event.preventDefault()
  const href = anchor.getAttribute('href') ?? ''
  if (href.startsWith('#')) {
    // Why: a native hash jump would change Orca's own location, so scroll to the bookmark instead.
    const id = decodeURIComponent(href.slice(1))
    const target = [...container.querySelectorAll('[id],[name]')].find(
      (element) => element.id === id || element.getAttribute('name') === id
    )
    target?.scrollIntoView({ block: 'start' })
    return
  }
  if (/^https?:\/\//i.test(href)) {
    openCsvHttpLink(href, event, { filePath })
  }
}
