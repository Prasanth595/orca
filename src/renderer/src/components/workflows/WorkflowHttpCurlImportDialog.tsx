import { useState } from 'react'
import { Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { parseCurlCommand } from '../../../../shared/workflow-http-curl-import'
import type { HttpRequestData } from '../../../../shared/workflow-http-request-types'

type Props = { onImport: (data: HttpRequestData) => void }

export default function WorkflowHttpCurlImportDialog({ onImport }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [command, setCommand] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleImport(): void {
    try {
      onImport(parseCurlCommand(command))
      setOpen(false)
      setCommand('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="w-full h-7" onClick={() => setOpen(true)}>
        <Terminal className="size-3.5" />
        {translate('workflows.http.importCurl', 'Import cURL')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {translate('workflows.http.importCurlTitle', 'Import cURL command')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'workflows.http.importCurlDescription',
                'Paste a cURL command. It replaces the current request settings.'
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            variant="code"
            rows={8}
            value={command}
            onChange={(e) => {
              setCommand(e.target.value)
              setError(null)
            }}
            placeholder="curl -X POST https://api.example.com -H 'Content-Type: application/json' -d '{}'"
            autoFocus
          />
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {translate('workflows.http.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleImport} disabled={!command.trim()}>
              {translate('workflows.http.import', 'Import')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
