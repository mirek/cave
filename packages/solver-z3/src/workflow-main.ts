#!/usr/bin/env node

import { runWorkflowFixture } from './workflow-fixture.ts'

const result = await runWorkflowFixture(process.argv.slice(2))
if (result.out !== '') process.stdout.write(result.out)
if (result.err !== '') process.stderr.write(result.err)
process.exitCode = result.code
