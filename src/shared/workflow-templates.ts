import type { WorkflowNode, WorkflowEdge } from './workflow-types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkflowTemplate = {
  id: string
  name: string
  description: string
  /** Template node IDs use short labels (e.g. "tpl_n1") replaced at materialize time. */
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

// ─── Materializer ─────────────────────────────────────────────────────────────

/**
 * Replaces every template-local ID with a fresh UUID.
 * String fields (e.g. FileWrite content expressions) are also rewritten so
 * `{{steps.tpl_n2.output}}` becomes `{{steps.<real-uuid>.output}}`.
 */
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

// ─── Template definitions ────────────────────────────────────────────────────

/**
 * T1: Hello World
 * ManualTrigger → Shell(echo) → FileWrite
 */
const HELLO_WORLD: WorkflowTemplate = {
  id: 'hello-world',
  name: 'Hello World',
  description: 'A simple three-node pipeline: run a shell command and write its output to a file.',
  nodes: [
    { id: 'tpl_n1', type: 'trigger_manual', pos: { x: 40, y: 100 }, data: {} },
    {
      id: 'tpl_n2',
      type: 'shell_command',
      pos: { x: 280, y: 100 },
      data: {
        command: 'echo "Hello from Orca!"',
        workingDirectory: '',
        timeoutSeconds: 10,
        shell: 'bash'
      }
    },
    {
      id: 'tpl_n3',
      type: 'file_write',
      pos: { x: 520, y: 100 },
      data: {
        filePath: '/tmp/orca-hello.txt',
        content: '{{steps.tpl_n2.output}}',
        mode: 'overwrite',
        createParents: true
      }
    }
  ],
  edges: [
    { id: 'tpl_e1', sourceNodeId: 'tpl_n1', targetNodeId: 'tpl_n2' },
    { id: 'tpl_e2', sourceNodeId: 'tpl_n2', targetNodeId: 'tpl_n3' }
  ]
}

/**
 * T2: System Snapshot
 * ManualTrigger → Shell(hostname) → Python(format JSON) → FileWrite
 */
const SYSTEM_SNAPSHOT: WorkflowTemplate = {
  id: 'system-snapshot',
  name: 'System Snapshot',
  description: 'Captures hostname, timestamp and OS via Python and writes a JSON report.',
  nodes: [
    { id: 'tpl_n1', type: 'trigger_manual', pos: { x: 40, y: 100 }, data: {} },
    {
      id: 'tpl_n2',
      type: 'shell_command',
      pos: { x: 280, y: 100 },
      data: { command: 'hostname', workingDirectory: '', timeoutSeconds: 10, shell: 'bash' }
    },
    {
      id: 'tpl_n3',
      type: 'python_script',
      pos: { x: 520, y: 100 },
      data: {
        script: [
          'import sys, json, datetime, platform',
          'hostname = sys.stdin.read().strip()',
          'print(json.dumps({',
          "    'hostname': hostname,",
          "    'timestamp': datetime.datetime.utcnow().isoformat() + 'Z',",
          "    'platform': platform.system()",
          '}, indent=2))'
        ].join('\n'),
        workingDirectory: '',
        timeoutSeconds: 15,
        pythonBin: 'python3'
      }
    },
    {
      id: 'tpl_n4',
      type: 'file_write',
      pos: { x: 760, y: 100 },
      data: {
        filePath: '/tmp/orca-snapshot.json',
        content: '{{steps.tpl_n3.output}}',
        mode: 'overwrite',
        createParents: true
      }
    }
  ],
  edges: [
    { id: 'tpl_e1', sourceNodeId: 'tpl_n1', targetNodeId: 'tpl_n2' },
    { id: 'tpl_e2', sourceNodeId: 'tpl_n2', targetNodeId: 'tpl_n3' },
    { id: 'tpl_e3', sourceNodeId: 'tpl_n3', targetNodeId: 'tpl_n4' }
  ]
}

/**
 * T3: Number Squarer
 * ManualTrigger → Python(gen [1-5]) → ForEach →[body] Python(square) / →[done] Collect → FileWrite
 */
const NUMBER_SQUARER: WorkflowTemplate = {
  id: 'number-squarer',
  name: 'Number Squarer',
  description:
    'Generates a list of numbers, squares each one with ForEach, then saves the results.',
  nodes: [
    { id: 'tpl_n1', type: 'trigger_manual', pos: { x: 40, y: 130 }, data: {} },
    {
      id: 'tpl_n2',
      type: 'python_script',
      pos: { x: 280, y: 130 },
      data: {
        script: 'import json\nprint(json.dumps([1, 2, 3, 4, 5]))',
        workingDirectory: '',
        timeoutSeconds: 10,
        pythonBin: 'python3'
      }
    },
    {
      id: 'tpl_n3',
      type: 'for_each',
      pos: { x: 520, y: 130 },
      data: { itemsExpression: '{{steps.tpl_n2.output}}', maxIterations: 20 }
    },
    {
      id: 'tpl_n4',
      type: 'python_script',
      pos: { x: 760, y: 130 },
      data: {
        script: [
          'import sys, json',
          'n = json.loads(sys.stdin.read())',
          "print(json.dumps({'n': n, 'squared': n * n}))"
        ].join('\n'),
        workingDirectory: '',
        timeoutSeconds: 10,
        pythonBin: 'python3'
      }
    },
    { id: 'tpl_n5', type: 'collect', pos: { x: 1000, y: 130 }, data: {} },
    {
      id: 'tpl_n6',
      type: 'file_write',
      pos: { x: 1240, y: 130 },
      data: {
        filePath: '/tmp/orca-squared.json',
        content: '{{steps.tpl_n5.output}}',
        mode: 'overwrite',
        createParents: true
      }
    }
  ],
  edges: [
    { id: 'tpl_e1', sourceNodeId: 'tpl_n1', targetNodeId: 'tpl_n2' },
    { id: 'tpl_e2', sourceNodeId: 'tpl_n2', targetNodeId: 'tpl_n3' },
    { id: 'tpl_e3', sourceNodeId: 'tpl_n3', targetNodeId: 'tpl_n4', outputSelector: 'body' },
    { id: 'tpl_e4', sourceNodeId: 'tpl_n3', targetNodeId: 'tpl_n5', outputSelector: 'done' },
    { id: 'tpl_e5', sourceNodeId: 'tpl_n5', targetNodeId: 'tpl_n6' }
  ]
}

/**
 * T4: Random Branch
 * ManualTrigger → Python(random 1-100) → Branch(>50 → "high" / "low") → FileWrite (each path)
 */
const RANDOM_BRANCH: WorkflowTemplate = {
  id: 'random-branch',
  name: 'Random Branch',
  description:
    'Picks a random number and routes to different file outputs based on whether it is above or below 50.',
  nodes: [
    { id: 'tpl_n1', type: 'trigger_manual', pos: { x: 40, y: 130 }, data: {} },
    {
      id: 'tpl_n2',
      type: 'python_script',
      pos: { x: 280, y: 130 },
      data: {
        script: 'import random\nprint(random.randint(1, 100))',
        workingDirectory: '',
        timeoutSeconds: 10,
        pythonBin: 'python3'
      }
    },
    {
      id: 'tpl_n3',
      type: 'branch',
      pos: { x: 520, y: 130 },
      data: {
        conditions: [{ label: 'high', field: 'output', operator: 'gt', value: '50' }],
        defaultLabel: 'low'
      }
    },
    {
      id: 'tpl_n4',
      type: 'file_write',
      pos: { x: 760, y: 60 },
      data: {
        filePath: '/tmp/orca-branch-high.txt',
        content: 'Number was HIGH (> 50): {{steps.tpl_n2.output}}',
        mode: 'overwrite',
        createParents: true
      }
    },
    {
      id: 'tpl_n5',
      type: 'file_write',
      pos: { x: 760, y: 200 },
      data: {
        filePath: '/tmp/orca-branch-low.txt',
        content: 'Number was LOW (≤ 50): {{steps.tpl_n2.output}}',
        mode: 'overwrite',
        createParents: true
      }
    }
  ],
  edges: [
    { id: 'tpl_e1', sourceNodeId: 'tpl_n1', targetNodeId: 'tpl_n2' },
    { id: 'tpl_e2', sourceNodeId: 'tpl_n2', targetNodeId: 'tpl_n3' },
    { id: 'tpl_e3', sourceNodeId: 'tpl_n3', targetNodeId: 'tpl_n4', outputSelector: 'high' },
    { id: 'tpl_e4', sourceNodeId: 'tpl_n3', targetNodeId: 'tpl_n5', outputSelector: 'low' }
  ]
}

/**
 * T5: CSV to JSON
 * ManualTrigger → Python(gen CSV) → FileWrite(input.csv) → FileRead → Python(CSV→JSON) → FileWrite(output.json)
 */
const CSV_TO_JSON: WorkflowTemplate = {
  id: 'csv-to-json',
  name: 'CSV to JSON',
  description:
    'Generates sample CSV data, writes it to disk, reads it back, converts to JSON, and saves the result.',
  nodes: [
    { id: 'tpl_n1', type: 'trigger_manual', pos: { x: 40, y: 100 }, data: {} },
    {
      id: 'tpl_n2',
      type: 'python_script',
      pos: { x: 280, y: 100 },
      data: {
        script: [
          'print("name,score,grade")',
          'print("Alice,95,A")',
          'print("Bob,87,B")',
          'print("Carol,92,A")',
          'print("Dave,78,C")'
        ].join('\n'),
        workingDirectory: '',
        timeoutSeconds: 10,
        pythonBin: 'python3'
      }
    },
    {
      id: 'tpl_n3',
      type: 'file_write',
      pos: { x: 520, y: 100 },
      data: {
        filePath: '/tmp/orca-input.csv',
        content: '{{steps.tpl_n2.output}}',
        mode: 'overwrite',
        createParents: true
      }
    },
    {
      id: 'tpl_n4',
      type: 'file_read',
      pos: { x: 760, y: 100 },
      data: { filePath: '/tmp/orca-input.csv' }
    },
    {
      id: 'tpl_n5',
      type: 'python_script',
      pos: { x: 1000, y: 100 },
      data: {
        script: [
          'import sys, json, csv, io',
          'text = sys.stdin.read()',
          'reader = csv.DictReader(io.StringIO(text))',
          'rows = [dict(r) for r in reader]',
          'print(json.dumps(rows, indent=2))'
        ].join('\n'),
        workingDirectory: '',
        timeoutSeconds: 15,
        pythonBin: 'python3'
      }
    },
    {
      id: 'tpl_n6',
      type: 'file_write',
      pos: { x: 1240, y: 100 },
      data: {
        filePath: '/tmp/orca-output.json',
        content: '{{steps.tpl_n5.output}}',
        mode: 'overwrite',
        createParents: true
      }
    }
  ],
  edges: [
    { id: 'tpl_e1', sourceNodeId: 'tpl_n1', targetNodeId: 'tpl_n2' },
    { id: 'tpl_e2', sourceNodeId: 'tpl_n2', targetNodeId: 'tpl_n3' },
    { id: 'tpl_e3', sourceNodeId: 'tpl_n3', targetNodeId: 'tpl_n4' },
    { id: 'tpl_e4', sourceNodeId: 'tpl_n4', targetNodeId: 'tpl_n5' },
    { id: 'tpl_e5', sourceNodeId: 'tpl_n5', targetNodeId: 'tpl_n6' }
  ]
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  HELLO_WORLD,
  SYSTEM_SNAPSHOT,
  NUMBER_SQUARER,
  RANDOM_BRANCH,
  CSV_TO_JSON
]
