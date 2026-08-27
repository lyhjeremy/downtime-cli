import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadConfig, applyOverrides, configPath, stateDir, writeSetting } from './config.js'
import { runSession, registry } from './session.js'
import { bold, dim, cyan, yellow } from './tui/ansi.js'

const here = dirname(fileURLToPath(import.meta.url))

function version() {
  try {
    return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

const HELP = `${cyan('downtime')}: fill the wait, then land back on your feet

${bold('Usage')}
  dt <command> [args...]              the short form
  downtime run <command> [args...]    the explicit form, same thing
  dt [options] -- <command> [args...]
  downtime config
  downtime config set <key> <value>
  downtime --help | --version

${bold('Options for run')}
  -t, --threshold <seconds>   wait this long before downtime mode (default 5)
      --entry <auto|manual>   open automatically, or on a keypress
      --exit <immediate|finish_round>
                              snap back the instant the task ends, or let the
                              current question finish first
      --content <id>          content module to use (${registry.ids().join(', ')})

${bold('Examples')}
  dt npm run build
  dt claude -p "refactor the auth module"
  dt --threshold 15 --exit finish_round -- pytest -x
  downtime config set entry.thresholdSeconds 10

Set DOWNTIME_DISABLE=1 to turn downtime mode off without uninstalling.

Config lives at ${dim(configPath())}
`

class UsageError extends Error {}

export function parseArgs(argv) {
  if (argv.length === 0) return { command: 'help' }
  const [first, ...rest] = argv

  if (first === '--version' || first === '-v') return { command: 'version' }
  if (first === '--help' || first === '-h' || first === 'help') return { command: 'help' }
  if (first === 'config') return { command: 'config', args: rest }

  // `dt npm run build` works without the word `run`. Anything that is not a
  // known subcommand is treated as the command to wrap, so the short form is
  // the natural one and `run` stays for scripts that prefer to be explicit.
  const args = first === 'run' ? rest : [first, ...rest]

  const overrides = {}
  let i = 0
  for (; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') {
      i++
      break
    }
    if (!arg.startsWith('-')) break

    const takeValue = () => {
      const value = args[++i]
      if (value === undefined) throw new UsageError(`${arg} needs a value`)
      return value
    }

    switch (arg) {
      case '-t':
      case '--threshold': {
        const seconds = Number(takeValue())
        if (!Number.isFinite(seconds) || seconds < 0) {
          throw new UsageError('--threshold needs a number of seconds')
        }
        overrides.entry = { ...overrides.entry, thresholdSeconds: seconds }
        break
      }
      case '--entry': {
        const mode = takeValue()
        if (!['auto', 'manual'].includes(mode)) {
          throw new UsageError('--entry must be auto or manual')
        }
        overrides.entry = { ...overrides.entry, mode }
        break
      }
      case '--exit': {
        const mode = takeValue()
        if (!['immediate', 'finish_round'].includes(mode)) {
          throw new UsageError('--exit must be immediate or finish_round')
        }
        overrides.exit = { mode }
        break
      }
      case '--content': {
        const id = takeValue()
        if (!registry.has(id)) {
          throw new UsageError(`unknown content module "${id}". Available: ${registry.ids().join(', ')}`)
        }
        overrides.content = { module: id }
        break
      }
      default:
        throw new UsageError(`unknown option "${arg}"`)
    }
  }

  const rem = args.slice(i)
  if (rem.length === 0) throw new UsageError('downtime needs a command to run, e.g. dt npm run build')
  return { command: 'run', overrides, target: rem[0], targetArgs: rem.slice(1) }
}

export async function main(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`downtime: ${err.message}\n`)
      process.exitCode = 2
      return 2
    }
    throw err
  }

  if (parsed.command === 'help') {
    process.stdout.write(HELP)
    return 0
  }
  if (parsed.command === 'version') {
    process.stdout.write(version() + '\n')
    return 0
  }

  const { config, created, warnings, readOnly } = loadConfig()
  for (const warning of warnings) {
    process.stderr.write(yellow(`downtime: ${warning}`) + '\n')
  }

  if (parsed.command === 'config') {
    const [action, key, ...valueParts] = parsed.args
    if (action === 'set') {
      if (!key || valueParts.length === 0) {
        process.stderr.write('downtime: usage is downtime config set <key> <value>\n')
        process.exitCode = 2
        return 2
      }
      try {
        const { value } = writeSetting(key, valueParts.join(' '))
        process.stdout.write(`${key} = ${JSON.stringify(value)}\n`)
        return 0
      } catch (err) {
        process.stderr.write(`downtime: ${err.message}\n`)
        process.exitCode = 2
        return 2
      }
    }
    if (action && action !== 'path') {
      process.stderr.write(`downtime: unknown config command "${action}"\n`)
      process.exitCode = 2
      return 2
    }
    if (action === 'path') {
      process.stdout.write(configPath() + '\n')
      return 0
    }
    const note = readOnly ? dim('  (not writable, using defaults)') : created ? dim('  (just created)') : ''
    process.stdout.write(`${dim('config')}  ${configPath()}${note}\n`)
    process.stdout.write(`${dim('state')}   ${stateDir()}\n\n`)
    process.stdout.write(JSON.stringify(config, null, 2) + '\n')
    return 0
  }

  const effective = applyOverrides(config, parsed.overrides)
  const code = await runSession({
    command: parsed.target,
    args: parsed.targetArgs,
    config: effective,
  })
  process.exitCode = code
  return code
}
