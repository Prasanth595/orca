import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { getPlaneErrorCopy, type PlaneErrorKind } from '@/components/plane/plane-error-copy'
import { usePlaneHostLabel } from '@/components/plane/use-plane-host-label'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export function PlaneEmptyCard(props: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
      <PlaneIcon className="mb-4 size-8 text-muted-foreground/60" />
      <p className="text-base font-medium text-foreground">{props.title}</p>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{props.body}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{props.children}</div>
    </div>
  )
}

export function PlaneNeedsScope({ onChooseProjects }: { onChooseProjects: () => void }) {
  return (
    <PlaneEmptyCard
      title={translate('plane.tasks.needsScopeTitle', 'Choose Plane projects')}
      body={translate(
        'plane.tasks.needsScopeBody',
        'Pick which projects Orca lists. Your saved choice is no longer available, or none was made yet.'
      )}
    >
      <Button onClick={onChooseProjects}>
        {translate('plane.tasks.chooseProjects', 'Choose projects')}
      </Button>
    </PlaneEmptyCard>
  )
}

export function PlaneCredentialError(props: { kind: PlaneErrorKind; onReconnect: () => void }) {
  const hostLabel = usePlaneHostLabel()
  return (
    <PlaneEmptyCard
      title={translate('plane.tasks.credentialTitle', 'Reconnect Plane')}
      body={getPlaneErrorCopy(props.kind, hostLabel)}
    >
      <Button onClick={props.onReconnect}>
        {translate('plane.tasks.reconnect', 'Reconnect Plane')}
      </Button>
    </PlaneEmptyCard>
  )
}
