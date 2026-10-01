import test from 'node:test';import assert from 'node:assert/strict';import {withGitBashGuidance} from '../src/guidance.js';
test('shell guidance changes only the model-facing description',()=>{
 const original={name:'bash',description:'Native bash tool',execute:()=>{},parameters:{},output:{render:()=>[]},presentCall:()=>{}};const advertised=withGitBashGuidance(original);
 assert.equal(advertised.execute,original.execute);assert.equal(advertised.parameters,original.parameters);assert.equal(advertised.output,original.output);assert.equal(advertised.presentCall,original.presentCall);assert.equal(original.description,'Native bash tool');assert.match(advertised.description,/single quotes/);assert.match(advertised.description,/last argument/);
});
