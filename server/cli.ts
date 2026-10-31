import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { runAgent } from './engine/loop.js';
import { allTools } from './engine/tools/index.js';
import type { Approver } from './engine/permissions.js';
import { createProvider } from './engine/providers/index.js';
import type { Provider } from './engine/types.js';
import { startKarenServer, type RunningServer } from './serve.js';
import { envValue, profileDir, projectLogPath } from './migration.js';
import { EventLog } from './store/events.js';
import { MemoryStore } from './memory/notes.js';
import { sleepDistiller } from './memory/distiller.js';
import { sleep } from './memory/sleep.js';
import { setupVoice, voiceSetupHint } from './voice/setup.js';
const SYSTEM = 'You are KAREN. Be brief and precise. Use tools for the task at hand.';
const USAGE = [
  'usage:',
  '  karen run "<task>" [--cwd <dir>] [--log <path>] [--provider <id>] [--model <name>]',
  '  karen serve [--port <n>] [--data <dir>] [--provider <id>] [--model <name>]',
  '  karen sleep [--data <dir>] [--provider <id>] [--model <name>]',
  '  karen voice-setup [--yes] [--data <dir>]',
  '  karen rebuild [--data <dir>]',
].join('\n');

export type CliDeps = {
  provider?: Provider;
  cwd?: string;
  logPath?: string;
  dataDir?: string;
  readline?: (question: string) => Promise<string>;
  onReady?: (server: RunningServer) => void | Promise<void>;
};

export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        cwd: { type: 'string' },
        log: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        port: { type: 'string' },
        data: { type: 'string' },
        root: { type: 'string' },
        yes: { type: 'boolean' },
      },
    });
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  const [command, ...rest] = parsed.positionals;

  if (command === 'serve') {
    return serve(parsed.values, deps);
  }

  if (command === 'sleep') {
    return runSleepCommand(parsed.values, deps);
  }

  if (command === 'voice-setup') {
    const dataDir = deps.dataDir ?? parsed.values.data ?? profileDir();
    const consent = parsed.values.yes === true;
    const result = await setupVoice({
      dataDir,
      consent,
      onProgress: (message) => console.log(message),
    });
    for (const step of result.steps) console.log(step);
    if (!result.ok) console.log(voiceSetupHint(dataDir));
    return result.ok ? 0 : 1;
  }

  if (command === 'rebuild') {
    const dataDir = deps.dataDir ?? parsed.values.data ?? profileDir();
    const log = new EventLog(join(dataDir, 'events.db'));
    try {
      const memory = new MemoryStore(log);
      memory.rebuild();
      console.log(`rebuilt: ${memory.list({ includeDormant: true, includeForgotten: true }).length} notes`);
      return 0;
    } finally {
      log.close();
    }
  }

  if (command !== 'run' || rest.length === 0) {
    console.error(USAGE);
    return 1;
  }

  const cwd = parsed.values.cwd ?? deps.cwd ?? process.cwd();
  const logPath = parsed.values.log ?? deps.logPath ?? projectLogPath(cwd);
  const model = parsed.values.model ?? envValue('MODEL') ?? 'default';
  const task = rest.join(' ');

  let provider: Provider;
  try {
    provider = deps.provider ?? createProvider(parsed.values.provider ?? 'ollama', process.env);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  const ask = deps.readline ?? makeReadline();
  const approver: Approver = {
    async ask(req) {
      const detail = typeof req.args['command'] === 'string' ? req.args['command'] : JSON.stringify(req.args);
      const answer = await ask(`[onay] ${req.tool}: ${detail} — onayla? (e/h) `);
      return answer.trim().toLowerCase().startsWith('e');
    },
  };

  const log = new EventLog(logPath);
  const sessionId = `cli-${Date.now()}`;
  log.append('session_start', 'user', sessionId, { cwd, model, task });

  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const result = await runAgent(
      {
        provider,
        model,
        tools: allTools(cwd),
        approver,
        log,
        sessionId,
        cwd,
        system: SYSTEM,
        signal: controller.signal,
        onDelta: (delta) => {
          if (delta.type === 'text') process.stdout.write(delta.text);
        },
      },
      [{ role: 'user', content: task }],
    );

    process.stdout.write('\n');
    log.append('session_end', 'system', sessionId, { stopReason: result.stopReason, error: result.error });

    if (result.stopReason === 'error') {
      console.error(`hata: ${result.error ?? 'bilinmeyen'}`);
      return 1;
    }
    return 0;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    log.close();
  }
}

function makeReadline(): (question: string) => Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return async (question) => {
    const answer = await rl.question(question);
    return answer;
  };
}

type ParsedValues = { port?: string; data?: string; provider?: string; model?: string; root?: string };

async function runSleepCommand(values: ParsedValues, deps: CliDeps): Promise<number> {
  const dataDir = deps.dataDir ?? values.data ?? profileDir();
  const log = new EventLog(join(dataDir, 'events.db'));
  const memory = new MemoryStore(log);
  try {
    const distiller = sleepDistiller(
      process.env,
      deps.provider,
      values.model ?? envValue('MODEL') ?? 'default',
    );
    const report = await sleep(log, memory, { dataDir, ...(distiller ? { distiller } : {}) });
    console.log(JSON.stringify(report, null, 2));
    if (!distiller) {
      console.log('note: no model permission, only deterministic steps ran (KAREN_SLEEP_ALLOW_PAID=1 enables a paid model).');
    }
    return report.ran ? 0 : 1;
  } finally {
    log.close();
  }
}

async function serve(values: ParsedValues, deps: CliDeps): Promise<number> {
  const port = values.port === undefined ? 7331 : Number.parseInt(values.port, 10);
  if (!Number.isFinite(port) || port < 0) {
    console.error('invalid port');
    return 1;
  }

  let server: RunningServer;
  try {
    server = await startKarenServer({
      port,
      ...(deps.provider === undefined ? {} : { provider: deps.provider }),
      ...(deps.dataDir === undefined && values.data === undefined ? {} : { dataDir: deps.dataDir ?? values.data }),
      ...(values.model === undefined ? {} : { model: values.model }),
      ...(values.root === undefined ? {} : { rootDir: values.root }),
      ...(deps.cwd === undefined ? {} : { cwd: deps.cwd }),
    });
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  console.log(`KAREN ready: ${server.url}`);

  if (deps.onReady) {
    try {
      await deps.onReady(server);
    } finally {
      await server.close();
    }
    return 0;
  }

  await new Promise<void>((resolveStop) => {
    const stop = () => resolveStop();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await server.close();
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
