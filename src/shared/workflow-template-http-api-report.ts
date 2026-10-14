import type { WorkflowTemplate } from './workflow-templates'
import { edge, httpRequest, python, shell, trigger } from './workflow-template-node-builders'

// jsonplaceholder.typicode.com is a free, keyless fake REST API, so the example runs as-is.
export const HTTP_EXAMPLE_API = 'https://jsonplaceholder.typicode.com'
export const HTTP_EXAMPLE_REPORT_PATH = '/tmp/orca-http-report.txt'

/** Summarizes the todo list piped in from the HTTP GET node. */
export const TODO_SUMMARY_SCRIPT = [
  'import sys, json',
  'todos = json.load(sys.stdin)',
  "done = [t for t in todos if t.get('completed')]",
  "open_titles = [t['title'] for t in todos if not t.get('completed')]",
  'print(json.dumps({',
  "    'total': len(todos),",
  "    'completed': len(done),",
  "    'open': len(open_titles),",
  "    'completionRate': round(100 * len(done) / len(todos), 1) if todos else 0,",
  "    'nextUp': open_titles[:3]",
  '}, indent=2))'
].join('\n')

const REPORT_BODY = [
  '{',
  '  "title": "Todo report from {{steps.tpl_n2.output}}",',
  '  "body": "{{steps.tpl_n4.json.completed}} of {{steps.tpl_n4.json.total}} todos done ({{steps.tpl_n4.json.completionRate}}%)",',
  '  "userId": 1',
  '}'
].join('\n')

export const HTTP_API_REPORT: WorkflowTemplate = {
  id: 'http-api-report',
  name: 'HTTP API Report',
  description:
    'Fetches todos from a public API, summarizes them in Python, posts a report over HTTP, then prints it from the shell. Needs internet.',
  nodes: [
    trigger('tpl_n1', 40, 100),
    // printf drops the trailing newline so the hostname can sit inside JSON strings.
    shell('tpl_n2', 280, 100, `printf '%s' "$(hostname)"`),
    httpRequest('tpl_n3', 520, 100, {
      method: 'GET',
      url: `${HTTP_EXAMPLE_API}/todos`,
      sendQuery: true,
      queryParameters: [{ name: 'userId', value: '1' }]
    }),
    python('tpl_n4', 760, 100, TODO_SUMMARY_SCRIPT, 15),
    httpRequest('tpl_n5', 1000, 100, {
      method: 'POST',
      url: `${HTTP_EXAMPLE_API}/posts`,
      sendHeaders: true,
      headers: [{ name: 'X-Report-Host', value: '{{steps.tpl_n2.output}}' }],
      sendBody: true,
      bodyContentType: 'json',
      bodyMode: 'json',
      bodyJson: REPORT_BODY
    }),
    shell(
      'tpl_n6',
      1240,
      100,
      `printf 'Published report #%s: %s\\n' '{{steps.tpl_n5.json.id}}' '{{steps.tpl_n5.json.body}}' | tee ${HTTP_EXAMPLE_REPORT_PATH}`
    )
  ],
  edges: [
    edge('tpl_e1', 'tpl_n1', 'tpl_n2'),
    edge('tpl_e2', 'tpl_n2', 'tpl_n3'),
    edge('tpl_e3', 'tpl_n3', 'tpl_n4'),
    edge('tpl_e4', 'tpl_n4', 'tpl_n5'),
    edge('tpl_e5', 'tpl_n5', 'tpl_n6')
  ]
}
