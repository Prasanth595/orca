import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { parseArguments as parseBlueGreen } from './deploy-relay-blue-green.mjs'
import { parseArguments as parseGceCandidate } from './deploy-relay-gce-candidate.mjs'
import { RELAY_WORKFLOW_DIRECTORY, readRelayWorkflow } from './relay-repository.mjs'

// Every workflow's real argv, literals as written: a flag combination the parser refuses
// (staging's lone --admin-audience once was one) fails here instead of on a release.

const PROJECT = 'orca-test-project'
const DIGEST = `sha256:${'a'.repeat(64)}`

// Shell-expanded values only; anything a workflow writes literally is parsed as written.
const SAMPLES = {
  project: PROJECT,
  image: `relay@${DIGEST}`,
  'predecessor-image-digest': DIGEST,
  'director-cells-json': JSON.stringify([
    { id: 'cell-a', url: 'https://cell-a.example.test', region: 'us-central1', capacityRequests: 10, initiallyEnabled: true }
  ]),
  'regional-placement-secret-version': '3',
  'min-instances': '1',
  'max-instances': '5',
  'prune-revisions': 'false',
  'bootstrap-runtime-identity': 'false',
  'expected-rehome-generation': '4',
  'region-correction-cohort-percent': '10',
  'rehome-audience': 'https://relay.example.test/v1/admin/host-drain',
  'director-origin': 'https://relay.example.test',
  'admin-audience': 'https://relay.example.test/v1/admin/drain',
  'reserve-placement': 'preserve',
  'shadow-seat-feed-cells': 'preserve',
  mode: 'audit'
}

function sample(flag) {
  if (flag in SAMPLES) return SAMPLES[flag]
  if (flag.endsWith('service-account')) return `${flag.slice(0, 20).replace(/-$/, '')}@${PROJECT}.iam.gserviceaccount.com`
  return `sample-${flag}`
}

// Optional arrays staging's guard step never sends together: an identity bootstrap, a shape
// adoption and a one-cell topology change each exclude the other two.
const EXCLUSIVE_ARRAYS = [['identity_args', 'shape_args', 'topology_args']]

function argument(flag, value) {
  return [flag, value.includes('$') ? sample(flag.slice(2)) : value]
}

// Flags a workflow passes through a bash array (`"${name[@]}"`), from every `name=(...)` it assigns.
function arrayArguments(source, name) {
  const flags = []
  for (const match of source.matchAll(new RegExp(`\\b${name}=\\(([^)]*)\\)`, 'g'))) {
    for (const entry of match[1].matchAll(/(--[a-z0-9-]+)\s+("[^"]*"|\S+)/g)) {
      flags.push([entry[1], entry[2].replace(/^"(.*)"$/, '$1')])
    }
  }
  if (flags.length === 0) throw new Error(`no flags assigned to ${name}`)
  return flags
}

// Each invocation's argument lines in order: `{ argv }` for a written flag, `{ array }` for a splice.
function invocations(source, script) {
  const lines = source.split('\n')
  const found = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes(`dev/scripts/${script}`)) continue
    const parts = []
    let line = lines[index]
    while (line.trimEnd().endsWith('\\')) {
      line = lines[++index]
      const array = /^\s*"\$\{([a-z_]+)\[@\]\}"\s*\\?\s*$/.exec(line)
      if (array) {
        parts.push({ array: array[1] })
        continue
      }
      const match = /^\s*(--[a-z0-9-]+)\s+(.+?)\s*\\?\s*$/.exec(line)
      if (!match) throw new Error(`unparsed ${script} argument line: ${line.trim()}`)
      const [, flag, raw] = match
      // A trailing `)"` closes the command substitution the invocation sits in.
      parts.push({ argv: argument(flag, raw.replace(/\)"$/, '').replace(/^"(.*)"$/, '$1')) })
    }
    found.push(parts)
  }
  return found
}

// Every argv an invocation can send: all other arrays always, plus none or one of each exclusive set.
function argvVariants(source, parts) {
  const spliced = parts.flatMap((part) => (part.array ? [part.array] : []))
  let selections = [spliced.filter((name) => !EXCLUSIVE_ARRAYS.some((set) => set.includes(name)))]
  for (const set of EXCLUSIVE_ARRAYS) {
    const present = set.filter((name) => spliced.includes(name))
    selections = selections.flatMap((selected) => [
      selected,
      ...present.map((name) => [...selected, name])
    ])
  }
  return selections.map((selected) =>
    parts.flatMap((part) => {
      if (part.argv) return part.argv
      if (!selected.includes(part.array)) return []
      return arrayArguments(source, part.array).flatMap(([flag, value]) => argument(flag, value))
    })
  )
}

const SCRIPTS = [
  ['deploy-relay-blue-green.mjs', parseBlueGreen],
  ['deploy-relay-gce-candidate.mjs', parseGceCandidate]
]

for (const [script, parse] of SCRIPTS) {
  test(`every workflow's ${script} argv parses`, () => {
    let count = 0
    for (const file of readdirSync(RELAY_WORKFLOW_DIRECTORY).filter((name) => name.endsWith('.yml'))) {
      const source = readFileSync(new URL(file, RELAY_WORKFLOW_DIRECTORY), 'utf8')
      for (const parts of invocations(source, script)) {
        count++
        for (const argv of argvVariants(source, parts)) {
          assert.doesNotThrow(() => parse(argv), `${file}: ${argv.join(' ')}`)
        }
      }
    }
    assert.ok(count > 0, `no workflow runs ${script}`)
  })
}

test('the production and staging director workflows are among the parsed', () => {
  for (const name of ['deploy-relay-production-director.yml', 'deploy-relay-staging.yml']) {
    assert.equal(invocations(readRelayWorkflow(name), 'deploy-relay-blue-green.mjs').length, 1, name)
  }
})

test("staging's exclusive arrays are each parsed, never two at once", () => {
  const source = readRelayWorkflow('deploy-relay-staging.yml')
  const [parts] = invocations(source, 'deploy-relay-blue-green.mjs')
  const variants = argvVariants(source, parts)
  const exclusive = ['--bootstrap-runtime-identity', '--shape-baseline-revision', '--capacity-cell-id']
  assert.deepEqual(
    variants.map((argv) => exclusive.filter((flag) => argv.includes(flag))),
    [[], ['--bootstrap-runtime-identity'], ['--shape-baseline-revision'], ['--capacity-cell-id']]
  )
  assert.ok(variants.every((argv) => argv.includes('--min-instances')))
})
