import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countdownParts,initializeLaunchCountdown} from '../dist/launch-countdown.js';
import {TOKEN_LAUNCH_AT} from '../dist/launch-config.js';
const launch=Date.parse(TOKEN_LAUNCH_AT);
test('all visitors count toward one fixed UTC launch deadline',()=>{
 assert.ok(Number.isFinite(launch));
 assert.deepEqual(countdownParts(launch,launch-86400000),{hours:24,minutes:0,seconds:0,complete:false});
 assert.deepEqual(countdownParts(launch,launch-3661000),{hours:1,minutes:1,seconds:1,complete:false});
 assert.deepEqual(countdownParts(launch,launch-1),{hours:0,minutes:0,seconds:1,complete:false});
 assert.deepEqual(countdownParts(launch,launch),{hours:0,minutes:0,seconds:0,complete:true});
 assert.deepEqual(countdownParts(launch,launch+100000),{hours:0,minutes:0,seconds:0,complete:true});
 assert.equal(countdownParts(TOKEN_LAUNCH_AT,launch-60000).minutes,1);
 assert.throws(()=>countdownParts('not-a-date'),TypeError);
});
test('refreshing does not create a new 24-hour deadline',()=>{
 const first=countdownParts(TOKEN_LAUNCH_AT,launch-86400000);
 const refreshed=countdownParts(TOKEN_LAUNCH_AT,launch-86400000+90000);
 assert.equal(first.hours,24);assert.deepEqual(refreshed,{hours:23,minutes:58,seconds:30,complete:false});
});
test('completion announces the scheduled time, without falsely claiming the token is live',()=>{
 const clock={hidden:false},label={},note={};
 const selectors={'.launch-countdown-label':label,'[role="timer"]':clock,'.launch-countdown-note':note,time:{}};
 const panel={dataset:{},querySelector:selector=>selectors[selector]};
 globalThis.document={addEventListener(){},removeEventListener(){}};globalThis.window={addEventListener(){}};
 const stop=initializeLaunchCountdown({querySelector:()=>panel},{deadline:TOKEN_LAUNCH_AT,now:()=>launch+1});
 assert.equal(clock.hidden,true);assert.equal(label.textContent,'Scheduled launch time reached');
 assert.equal(note.textContent,'Follow Twitter / X for launch updates.');assert.equal(panel.dataset.state,'complete');stop();
});
