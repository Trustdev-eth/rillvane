import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from './database.mjs';
import {listCandles} from './protocol.mjs';

test('historical candle requests return complete buckets, deterministic OHLC and history bounds',()=>{
 const db=openDatabase(':memory:');
 try{
  const now=Date.UTC(2025,0,20),ms=3600000,old=now-300*ms;
  const insert=db.prepare('INSERT INTO trades(side,price,base_amount,quote_amount,created) VALUES(?,?,?,?,?)');
  for(const [time,price] of [[old+1000,100],[old+2000,105],[old+2000,102],[now,110],[now+ms,120]])insert.run('buy',String(price*1e6),'1000000','100000000',time);
  const live=listCandles(db,'1h',now);
  assert.equal(live.items.at(-1).close,110);
  assert.ok(live.items.length>=1);
  assert.equal(live.earliest,old+1000);assert.equal(live.hasMore,true);
  const historical=listCandles(db,'1h',now,{end:old+5000,count:12});
  const printed=historical.items.find(item=>item.volume>0);
  assert.deepEqual(printed,{time:old,open:100,high:105,low:100,close:102,volume:3,price:102});
  assert.ok(historical.items.every(c=>c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)));
  assert.equal(historical.hasMore,false);
  const bounded=listCandles(db,'1h',now,{end:now+100*ms,count:100000});
  assert.equal(bounded.end,now);assert.equal(bounded.from,now-599*ms);
  assert.equal(listCandles(db,'1h',now,{end:'invalid',count:'invalid'}).end,now);
 }finally{db.close();}
});

test('trading history fills a window when no swaps have printed and ends on the oracle',()=>{
 const db=openDatabase(':memory:');
 try{
  const now=Date.UTC(2026,9,29,18);
  const blank=listCandles(db,'1h',now,{count:64});
  assert.equal(blank.items.length,64);
  assert.equal(blank.items.at(-1).close,100);
  assert.ok(blank.items.some(c=>c.high>c.low));
  assert.ok(blank.items.every(c=>c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close)));
  assert.ok(new Set(blank.items.map(c=>c.close)).size>1);
  assert.equal(blank.hasMore,true);
  assert.ok(blank.earliest<blank.from);
 }finally{db.close();}
});
