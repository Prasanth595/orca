import type { WorkflowNode, WorkflowEdge, BranchConditionOperator } from './workflow-types'

export type WorkflowTemplate = {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

// ─── Materializer ─────────────────────────────────────────────────────────────

export function materializeTemplate(
  template: WorkflowTemplate,
  idGen: () => string
): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; name: string } {
  const idMap = new Map<string, string>()
  for (const n of template.nodes) {
    idMap.set(n.id, idGen())
  }
  for (const e of template.edges) {
    idMap.set(e.id, idGen())
  }

  function remap(value: unknown): unknown {
    if (typeof value === 'string') {
      let s = value
      for (const [tplId, realId] of idMap) {
        s = s.replaceAll(tplId, realId)
      }
      return s
    }
    if (Array.isArray(value)) {
      return value.map(remap)
    }
    if (value !== null && typeof value === 'object') {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: guarded by null + typeof object checks above; not an array (checked above).
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remap(v)])
      )
    }
    return value
  }

  const nodes = template.nodes.map((n) => ({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: remap does a structural deep-copy of a WorkflowNode; shape is preserved.
    ...(remap(n) as WorkflowNode),
    id: idMap.get(n.id)!
  }))
  const edges = template.edges.map((e) => ({
    id: idMap.get(e.id)!,
    sourceNodeId: idMap.get(e.sourceNodeId)!,
    targetNodeId: idMap.get(e.targetNodeId)!,
    ...(e.outputSelector !== undefined ? { outputSelector: e.outputSelector } : {})
  }))
  return { nodes, edges, name: template.name }
}

// ─── Node builders ────────────────────────────────────────────────────────────

const pos = (x: number, y: number) => ({ x, y })
const trigger = (id: string, x: number, y: number): WorkflowNode => ({
  id,
  type: 'trigger_manual',
  pos: pos(x, y),
  data: {}
})
const shell = (id: string, x: number, y: number, command: string, timeout = 10): WorkflowNode => ({
  id,
  type: 'shell_command',
  pos: pos(x, y),
  data: { command, workingDirectory: '', timeoutSeconds: timeout, shell: 'bash' }
})
const python = (id: string, x: number, y: number, script: string, timeout = 10): WorkflowNode => ({
  id,
  type: 'python_script',
  pos: pos(x, y),
  data: { script, workingDirectory: '', timeoutSeconds: timeout, pythonBin: 'python3' }
})
const fw = (id: string, x: number, y: number, filePath: string, content: string): WorkflowNode => ({
  id,
  type: 'file_write',
  pos: pos(x, y),
  data: { filePath, content, mode: 'overwrite', createParents: true }
})
const fr = (id: string, x: number, y: number, filePath: string): WorkflowNode => ({
  id,
  type: 'file_read',
  pos: pos(x, y),
  data: { filePath }
})
const forEach = (id: string, x: number, y: number, expr: string): WorkflowNode => ({
  id,
  type: 'for_each',
  pos: pos(x, y),
  data: { itemsExpression: expr, maxIterations: 20 }
})
const collect = (id: string, x: number, y: number): WorkflowNode => ({
  id,
  type: 'collect',
  pos: pos(x, y),
  data: {}
})
const branch1 = (
  id: string,
  x: number,
  y: number,
  label: string,
  field: string,
  operator: BranchConditionOperator,
  value: string,
  defaultLabel: string
): WorkflowNode => ({
  id,
  type: 'branch',
  pos: pos(x, y),
  data: { conditions: [{ label, field, operator, value }], defaultLabel }
})
const edge = (id: string, s: string, t: string, sel?: string): WorkflowEdge => ({
  id,
  sourceNodeId: s,
  targetNodeId: t,
  ...(sel ? { outputSelector: sel } : {})
})

// ─── Script constants ─────────────────────────────────────────────────────────

const SNAPSHOT_SCRIPT = [
  'import sys, json, datetime, platform',
  'hostname = sys.stdin.read().strip()',
  'print(json.dumps({',
  "    'hostname': hostname,",
  "    'timestamp': datetime.datetime.utcnow().isoformat() + 'Z',",
  "    'platform': platform.system()",
  '}, indent=2))'
].join('\n')

const SQUARE_SCRIPT = [
  'import sys, json',
  'n = json.loads(sys.stdin.read())',
  "print(json.dumps({'n': n, 'squared': n * n}))"
].join('\n')

const CSV_SCRIPT = [
  'import sys, json, csv, io',
  'text = sys.stdin.read()',
  'reader = csv.DictReader(io.StringIO(text))',
  'rows = [dict(r) for r in reader]',
  'print(json.dumps(rows, indent=2))'
].join('\n')

const CSV_GEN_SCRIPT = [
  'print("name,score,grade")',
  'print("Alice,95,A")',
  'print("Bob,87,B")',
  'print("Carol,92,A")',
  'print("Dave,78,C")'
].join('\n')

// ─── Templates ────────────────────────────────────────────────────────────────

const HELLO_WORLD: WorkflowTemplate = {
  id: 'hello-world',
  name: 'Hello World',
  description: 'A simple three-node pipeline: run a shell command and write its output to a file.',
  nodes: [
    trigger('tpl_n1', 40, 100),
    shell('tpl_n2', 280, 100, 'echo "Hello from Orca!"'),
    fw('tpl_n3', 520, 100, '/tmp/orca-hello.txt', '{{steps.tpl_n2.output}}')
  ],
  edges: [edge('tpl_e1', 'tpl_n1', 'tpl_n2'), edge('tpl_e2', 'tpl_n2', 'tpl_n3')]
}

const SYSTEM_SNAPSHOT: WorkflowTemplate = {
  id: 'system-snapshot',
  name: 'System Snapshot',
  description: 'Captures hostname, timestamp and OS via Python and writes a JSON report.',
  nodes: [
    trigger('tpl_n1', 40, 100),
    shell('tpl_n2', 280, 100, 'hostname'),
    python('tpl_n3', 520, 100, SNAPSHOT_SCRIPT, 15),
    fw('tpl_n4', 760, 100, '/tmp/orca-snapshot.json', '{{steps.tpl_n3.output}}')
  ],
  edges: [
    edge('tpl_e1', 'tpl_n1', 'tpl_n2'),
    edge('tpl_e2', 'tpl_n2', 'tpl_n3'),
    edge('tpl_e3', 'tpl_n3', 'tpl_n4')
  ]
}

const NUMBER_SQUARER: WorkflowTemplate = {
  id: 'number-squarer',
  name: 'Number Squarer',
  description:
    'Generates a list of numbers, squares each one with ForEach, then saves the results.',
  nodes: [
    trigger('tpl_n1', 40, 130),
    python('tpl_n2', 280, 130, 'import json\nprint(json.dumps([1, 2, 3, 4, 5]))'),
    forEach('tpl_n3', 520, 130, '{{steps.tpl_n2.output}}'),
    python('tpl_n4', 760, 130, SQUARE_SCRIPT),
    collect('tpl_n5', 1000, 130),
    fw('tpl_n6', 1240, 130, '/tmp/orca-squared.json', '{{steps.tpl_n5.output}}')
  ],
  edges: [
    edge('tpl_e1', 'tpl_n1', 'tpl_n2'),
    edge('tpl_e2', 'tpl_n2', 'tpl_n3'),
    edge('tpl_e3', 'tpl_n3', 'tpl_n4', 'body'),
    edge('tpl_e4', 'tpl_n3', 'tpl_n5', 'done'),
    edge('tpl_e5', 'tpl_n5', 'tpl_n6')
  ]
}

const RANDOM_BRANCH: WorkflowTemplate = {
  id: 'random-branch',
  name: 'Random Branch',
  description:
    'Picks a random number and routes to a different file based on whether it is above or below 50.',
  nodes: [
    trigger('tpl_n1', 40, 130),
    python('tpl_n2', 280, 130, 'import random\nprint(random.randint(1, 100))'),
    branch1('tpl_n3', 520, 130, 'high', 'output', 'gt', '50', 'low'),
    fw(
      'tpl_n4',
      760,
      60,
      '/tmp/orca-branch-high.txt',
      'Number was HIGH (> 50): {{steps.tpl_n2.output}}'
    ),
    fw(
      'tpl_n5',
      760,
      200,
      '/tmp/orca-branch-low.txt',
      'Number was LOW (≤ 50): {{steps.tpl_n2.output}}'
    )
  ],
  edges: [
    edge('tpl_e1', 'tpl_n1', 'tpl_n2'),
    edge('tpl_e2', 'tpl_n2', 'tpl_n3'),
    edge('tpl_e3', 'tpl_n3', 'tpl_n4', 'high'),
    edge('tpl_e4', 'tpl_n3', 'tpl_n5', 'low')
  ]
}

const CSV_TO_JSON: WorkflowTemplate = {
  id: 'csv-to-json',
  name: 'CSV to JSON',
  description:
    'Generates sample CSV data, writes it to disk, reads it back, converts to JSON, and saves the result.',
  nodes: [
    trigger('tpl_n1', 40, 100),
    python('tpl_n2', 280, 100, CSV_GEN_SCRIPT),
    fw('tpl_n3', 520, 100, '/tmp/orca-input.csv', '{{steps.tpl_n2.output}}'),
    fr('tpl_n4', 760, 100, '/tmp/orca-input.csv'),
    python('tpl_n5', 1000, 100, CSV_SCRIPT, 15),
    fw('tpl_n6', 1240, 100, '/tmp/orca-output.json', '{{steps.tpl_n5.output}}')
  ],
  edges: [
    edge('tpl_e1', 'tpl_n1', 'tpl_n2'),
    edge('tpl_e2', 'tpl_n2', 'tpl_n3'),
    edge('tpl_e3', 'tpl_n3', 'tpl_n4'),
    edge('tpl_e4', 'tpl_n4', 'tpl_n5'),
    edge('tpl_e5', 'tpl_n5', 'tpl_n6')
  ]
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  HELLO_WORLD,
  SYSTEM_SNAPSHOT,
  NUMBER_SQUARER,
  RANDOM_BRANCH,
  CSV_TO_JSON
]
