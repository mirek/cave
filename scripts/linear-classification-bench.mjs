// Wide shared-operand classification; an optional entrypoint selects a comparison implementation.
import {performance} from 'node:perf_hooks'
import {pathToFileURL} from 'node:url'
const {model}=await import(process.argv[2] ? pathToFileURL(process.argv[2]) : new URL('../packages/solver/src/linear.ts', import.meta.url))
const count=25000
const results=[]
for(const kind of ['add','multiply']) {
 const one={kind:'literal',sort:'real',value:'1'}
 const input={schema:'cave.solver/model@1',variables:[{id:'x',sort:'real'}],constraints:[],objectives:[{id:'wide',direction:'minimize',expression:{kind,operands:[{kind:'variable',id:'x'},...Array(count-1).fill(one)]}}]}
 model(input)
 const ms=[]
 for(let i=0;i<7;i++) {
  const start=performance.now();const result=model(input);ms.push(performance.now()-start)
  if(!result.linear) throw Error('unexpected nonlinear result')
 }
 results.push({kind,operands:count,ms,medianMs:[...ms].sort((a,b)=>a-b)[3]})
}
console.log(JSON.stringify({node:process.version,results}))
