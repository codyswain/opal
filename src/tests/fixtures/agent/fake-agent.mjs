#!/usr/bin/env node
// A stand-in for the agent command in tests and acceptance runs. It never
// touches the network. `auth status` prints a signed-in or signed-out answer;
// `-p` reads the prompt on standard input, prints one of the saved streams
// beside this file line by line, and edits the file the prompt names.
//
//   FAKE_AGENT_AUTH=out        auth status says signed out (and exits 1)
//   FAKE_AGENT_STREAM=name     success (default), error or signed-out
//   FAKE_AGENT_EDIT={"find":"a","replace":"b"}  the edit a success makes
//   FAKE_AGENT_REPLY=text      the success result's text
//   FAKE_AGENT_DELAY_MS=n      wait before the result line
//   FAKE_AGENT_NO_RESULT=1     end with no result line, after FAKE_AGENT_STDERR
//   FAKE_AGENT_STDERR=text     a line on standard error
//   FAKE_AGENT_LOG=file        append {args, cwd, prompt, keys} as one JSON line
//
// A comment holding "#fail", "#signed-out" or "#slow" picks the error
// stream, the signed-out stream or a 60 s wait, whatever the variables say.
import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const env = process.env;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (args[0] === 'auth' && args[1] === 'status') {
  const loggedIn = env.FAKE_AGENT_AUTH !== 'out';
  process.stdout.write(`${JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none', apiProvider: 'firstParty' }, null, 2)}\n`);
  process.exit(loggedIn ? 0 : 1);
}

process.on('SIGINT', () => {
  process.stderr.write('Interrupted by the user.\n');
  process.exit(130);
});

let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;

if (env.FAKE_AGENT_LOG) {
  const keys = Object.keys(env).filter((key) => key.startsWith('ANTHROPIC_'));
  appendFileSync(env.FAKE_AGENT_LOG, `${JSON.stringify({ args, cwd: process.cwd(), prompt, keys, path: env.PATH })}\n`);
}

const comment = prompt.split('\nComment:\n')[1]?.split('\n\nCarry out the comment.')[0] ?? '';
const stream = comment.includes('#fail') ? 'error'
  : comment.includes('#signed-out') ? 'signed-out'
    : env.FAKE_AGENT_STREAM || 'success';
const delay = comment.includes('#slow') ? 60_000 : Number(env.FAKE_AGENT_DELAY_MS || 0);
const lines = readFileSync(path.join(here, `${stream}.jsonl`), 'utf8').split('\n').filter(Boolean);
const result = lines.pop();

for (const line of lines) {
  process.stdout.write(`${line}\n`);
  await sleep(10);
}

if (stream === 'success' && env.FAKE_AGENT_EDIT) {
  const file = /^File: (.+)$/m.exec(prompt)?.[1];
  const { find, replace } = JSON.parse(env.FAKE_AGENT_EDIT);
  if (file) {
    const target = path.join(process.cwd(), file);
    writeFileSync(target, readFileSync(target, 'utf8').replace(find, replace));
  }
}

if (delay > 0) await sleep(delay);
if (env.FAKE_AGENT_STDERR) process.stderr.write(`${env.FAKE_AGENT_STDERR}\n`);
if (env.FAKE_AGENT_NO_RESULT === '1') process.exit(2);

const final = JSON.parse(result);
if (stream === 'success' && env.FAKE_AGENT_REPLY) final.result = env.FAKE_AGENT_REPLY;
process.stdout.write(`${JSON.stringify(final)}\n`);
process.exit(final.is_error ? 1 : 0);
