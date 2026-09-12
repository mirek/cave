/** Differential temporal-boundary audit against Python datetime; no runtime Python dependency. */
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import * as Time from '../packages/core/src/time.ts'

const generator = String.raw`
import datetime,json,platform
cases=[]
epoch=datetime.datetime(1970,1,1,tzinfo=datetime.timezone.utc)
for year in [1,4,99,100,1900,2000,2024,9999]:
 for month,day in [(1,2),(2,28),(6,15),(12,30)]:
  for hour,minute in [(0,0),(12,34),(23,59)]:
   for micros in [0,100000,123456]:
    for offset in [-1439,-330,0,345,1439]:
     tz=datetime.timezone(datetime.timedelta(minutes=offset))
     date=datetime.datetime(year,month,day,hour,minute,56,micros,tzinfo=tz)
     delta=date-epoch
     expected=delta.days*86400000+delta.seconds*1000+delta.microseconds//1000
     fraction='' if micros==0 else f'.{micros:06}'
     zone='Z' if offset==0 else ('-' if offset<0 else '+')+f'{abs(offset)//60:02}:{abs(offset)%60:02}'
     text=f'{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:56{fraction}{zone}'
     cases.append({'text':text,'expected':expected})
     if offset==0: cases.append({'text':text[:-1],'expected':expected})
invalid=['2025-02-29T00:00:00Z','1900-02-29T00:00:00Z','2026-04-31T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:60:00Z','2026-01-01T00:00:60Z','2026-01-01T00:00:00+24:00','2026-01-01T00:00:00-00:60','2026-01-01T00:00:00.Z']
for text in ['2026','2026-04','2026-04-10','2026-Q1','2026-W01','2026-01-01T00:00:00Z']:
 for suffix in ['\n','\r','\r\n','\u2028','\u2029',' ']: invalid.append(text+suffix)
print(json.dumps({'cases':cases,'invalid':invalid,'python':platform.python_version()}))
`
const oracle=spawnSync('python3',['-c',generator],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024})
assert.equal(oracle.status,0,`${oracle.error ?? oracle.signal ?? ''}\n${oracle.stderr}`)
const {cases,invalid,python}=JSON.parse(oracle.stdout)
for(const {text,expected} of cases) {
 assert.equal(Time.parseTimestamp(text),expected,text)
 assert.equal(Time.parseInstant(text),expected,text)
 assert.deepEqual(Time.parseBoundary(text),{start:expected,end:expected+1000},text)
}
for(const text of invalid) {
 assert.equal(Time.parseInstant(text),undefined,JSON.stringify(text))
 assert.equal(Time.parseBoundary(text),undefined,JSON.stringify(text))
}
console.log(JSON.stringify({node:process.version,python,timezone:process.env.TZ ?? 'host default',
 validTimestamps:cases.length,invalidBoundaries:invalid.length,checks:cases.length*3+invalid.length*2,
 sourceSha256:createHash('sha256').update(readFileSync(new URL('../packages/core/src/time.ts',import.meta.url))).digest('hex')}))
